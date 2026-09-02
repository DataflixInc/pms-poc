import base64
import logging
import os
import time
from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from dotenv import load_dotenv

load_dotenv()

import bcrypt
import jwt
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import email_service

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)
logger = logging.getLogger("pms")

from assesment_form import (
    delete_draft,
    delete_employee,
    fetch_all_employees,
    fetch_assigned_employees,
    fetch_draft,
    fetch_employees_managed_by,
    fetch_form_by_template_id,
    fetch_submission,
    fetch_submissions_for_employee,
    fetch_user_by_email,
    fetch_user_by_employee_id,
    fetch_users_by_designation,
    insert_employee,
    insert_form_submission,
    set_submission_approval,
    update_assigned_employees,
    update_employee,
    update_form_submission,
    upsert_draft,
)
from cosmos_client import lifespan

app = FastAPI(lifespan=lifespan)


# Ensures every unhandled error is actually recorded server-side (there was
# previously no logging at all, so a 500 left no trace to debug from) while
# still returning a generic message rather than a raw traceback to the client.
@app.exception_handler(Exception)
async def _log_unhandled_exception(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"success": False, "message": "Internal server error"})


# Comma-separated list, e.g. "https://app.example.com,https://staging.example.com".
# Falls back to the known dev + current prod origins so local `uvicorn main:app`
# keeps working without an .env entry.
_default_origins = "http://localhost:3000,http://localhost:8080,https://dataflix-pms-webui-ftf4e0hrb3dubbfa.eastus-01.azurewebsites.net"
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The frontend never sees this value — it only ever gets an already-signed
# token, and the browser cannot securely verify a signature anyway (see
# isTokenStructurallyValid in the frontend's jwtUtils.ts). No hardcoded
# fallback: an unset secret must fail startup rather than silently sign/verify
# tokens with a publicly-known default that lets anyone forge admin access.
JWT_SECRET = os.environ["JWT_SECRET"]

# Points awarded per rating option on the "Does not meet / Meets /
# Outstanding" questions.
RATING_OPTION_POINTS = {"Does not meet": 1, "Meets": 2, "Outstanding": 3}

# Self-evaluations aren't scored (an employee rating their own performance
# isn't a meaningful metric) — only the manager's evaluation of them is. See
# get_team_submissions, which skips _score_submission for this template.
SELF_EVALUATION_TEMPLATE_ID = 1001
MANAGER_EVALUATION_TEMPLATE_ID = 1002
HR_EVALUATION_TEMPLATE_ID = 1003
# Final sign-off after the HR Evaluation is submitted — CDO-only. Has a real
# self_evaluation_form row (a single "Additional Comments" question, for the
# CDO's optional remarks) but is otherwise treated as a one-time "approved"
# marker — GET/POST /api/forms/1004/... work through the same two generic
# endpoints as every other template, no new routes needed.
OVERALL_REVIEW_TEMPLATE_ID = 1004

# The only signal today that a dataflix_users row gets HR-level access —
# there's no dedicated role/is_hr column, so this reuses the existing
# `designation` value (confirmed against real data: it's the job-title
# column, not `department`, that holds "Senior Human Resource Executive").
# Chief Delivery Officer is included by request, to get the identical view.
HR_DESIGNATIONS = {"Senior Human Resource Executive", "Chief Delivery Officer"}
# CDO gets one extra ability beyond regular HR: final approval of the Overall
# Review, after the HR Evaluation is submitted (see submit_form below).
CDO_DESIGNATION = "Chief Delivery Officer"
# Distinct from HR_DESIGNATIONS above — used specifically to target a Manager
# Evaluation submission notification at regular HR only, not the CDO (who
# gets their own, later notification once the HR Evaluation is submitted).
SENIOR_HR_DESIGNATION = "Senior Human Resource Executive"

# Font sizes (px) applied to every form template rendered by the frontend —
# centralized here so all forms stay visually consistent from one source.
FORM_STYLES = {
    "title_font_size": 26,
    "header_font_size": 18,
    "question_font_size": 16,
    "answer_font_size": 16,
}


def _slider_rating_points(question, answer) -> Optional[int]:
    # Buckets a slider answer (e.g. a 0-10 "overall rating" scale) into the
    # same 1-3 point scale as the Does not meet/Meets/Outstanding radios
    # above, by splitting the slider's min-max range into even thirds —
    # mirrored in ratingSummary.ts's sliderRatingLabel for the frontend's
    # live donut, so the two never disagree on a slider's score.
    if answer is None:
        return None
    try:
        value = float(answer)
    except (TypeError, ValueError):
        return None
    lo = float(question.get("min", 0) or 0)
    hi = float(question.get("max", 10) or 10)
    if hi <= lo:
        return None
    fraction = min(max((value - lo) / (hi - lo), 0.0), 1.0)
    if fraction < 1 / 3:
        return 1
    if fraction < 2 / 3:
        return 2
    return 3


def _score_submission(questions, answers: Dict[str, Any]):
    # Only questions offering exactly the rating scale, or slider questions
    # (bucketed above), count toward the score — this naturally excludes
    # free-text questions and the Review Period radio.
    score = 0
    max_score = 0
    answered = 0
    for question in questions:
        is_rating_radio = set(question.get("options") or []) == set(RATING_OPTION_POINTS)
        is_slider = question.get("type") == "slider"
        if not is_rating_radio and not is_slider:
            continue
        max_score += max(RATING_OPTION_POINTS.values())
        answer = answers.get(str(question["question_number"]))
        if is_rating_radio:
            if answer in RATING_OPTION_POINTS:
                score += RATING_OPTION_POINTS[answer]
                answered += 1
        else:
            points = _slider_rating_points(question, answer)
            if points is not None:
                score += points
                answered += 1
    return {"score": score, "max_score": max_score, "answered": answered}


def _score_percentage(questions, submission) -> Optional[int]:
    # Powers OverallReviewTab's combined score without it having to fetch and
    # recompute this itself from the raw template+submission (which would
    # just duplicate HRManagerEvaluationTab's/HREvaluationTab's own fetch of
    # the exact same data) — questions/submission here are already fetched
    # once per request by the caller (get_hr_employees), not fetched again.
    # None when there's no submission, or the template has no rating
    # questions at all — 0% would misleadingly read as "worst possible"
    # rather than "nothing to score".
    if submission is None:
        return None
    result = _score_submission(questions, submission.answers)
    if result["max_score"] <= 0:
        return None
    return round(result["score"] / result["max_score"] * 100)


def _current_academic_year_start() -> int:
    # Academic year runs July-June, so before July it's still the previous year's cycle.
    now = datetime.now()
    return now.year if now.month >= 7 else now.year - 1


def _current_academic_year() -> str:
    start_year = _current_academic_year_start()
    return f"{start_year}-{start_year + 1}"


def _current_review_period() -> str:
    # Which of the two half-year periods (matching the "Review Period"
    # question's own options in _load_questions) we're actually in right now.
    now = datetime.now()
    start_year = _current_academic_year_start()
    if now.month >= 7:
        return f"July {start_year} - December {start_year}"
    return f"January {start_year + 1} - June {start_year + 1}"


def _current_review_period_id() -> str:
    # Stable id form of the current review period, e.g. "Jul 2026 - Dec
    # 2026" / "Jan 2027 - Jun 2027" — this is what submissions are actually
    # keyed/partitioned by (see _review_period_id_for_template below), so a
    # submission never collides with one from a different half. Independent
    # of the "-H1"/"-H2" ids _performance_cycle_review_periods returns to the
    # frontend for a different, pre-existing purpose — not renamed here to
    # avoid touching that separate contract.
    start_year = _current_academic_year_start()
    if datetime.now().month >= 7:
        return f"Jul {start_year} - Dec {start_year}"
    return f"Jan {start_year + 1} - Jun {start_year + 1}"


def _review_period_id_for_template(template_id: int) -> Optional[str]:
    # Every template, including the Overall Review, is scoped one-submission-
    # per-current-period (see fetch_submission/insert_form_submission/
    # update_form_submission in assesment_form.py). The Overall Review has no
    # "Review Period" question of its own — unlike the other three templates,
    # its period comes entirely from this server-side resolution, never from
    # a submitted answer — but it's still tracked per cycle like the others,
    # so a later cycle's approval doesn't overwrite/hide an earlier one.
    return _current_review_period_id()


def _review_period_sort_key(period: str):
    # Plain alphabetical sort would put "January {Y+1}..." before "July
    # {Y}..." within the same cycle, which happens to look right, but breaks
    # across different years/cycles (e.g. "January 2026..." would sort
    # before "July 2025..." despite coming later). Parses the label back
    # into (start_year, half) so the dropdown always lists periods in true
    # chronological order, regardless of string comparison quirks.
    try:
        if period.startswith("July"):
            return (int(period.split()[1]), 0)
        if period.startswith("January"):
            return (int(period.split()[1]) - 1, 1)
    except (ValueError, IndexError):
        pass
    return (0, 0)


def _performance_cycle_id(start_year: int) -> str:
    # The identifier for the performance cycle that begins in July of
    # `start_year` — e.g. 2026 -> "2026-2027". Deterministic and derived, not
    # stored anywhere, so it's automatically correct for any past or future
    # year without a lookup table.
    return f"{start_year}-{start_year + 1}"


def _performance_cycle_review_periods(start_year: int):
    # Every performance cycle has exactly two six-month review periods. This
    # is the single place that fact is encoded — both _current_review_period
    # (the "which one is active" question) and this grouping logic build on
    # the same two labels, so they can never drift apart.
    return [
        {
            "review_period_id": f"{start_year}-H1",
            "label": f"July {start_year} - December {start_year}",
        },
        {
            "review_period_id": f"{start_year}-H2",
            "label": f"January {start_year + 1} - June {start_year + 1}",
        },
    ]


def _current_performance_cycle() -> Dict[str, Any]:
    # Groups the current review period with its sibling from the SAME
    # performance cycle — never "the last two periods seen" or "the previous
    # chronological period". Both periods share one start_year (the same one
    # _current_academic_year_start() already derives), which is the actual
    # grouping key: July {Y}-Dec {Y} and Jan {Y+1}-June {Y+1} belong together
    # because they come from the same start_year, not because they happen to
    # be adjacent in time. This is why, e.g., during Jul 2027-Dec 2027 this
    # never pulls in Jan 2027-June 2027 (start_year 2026) — that period's
    # start_year doesn't match this cycle's.
    start_year = _current_academic_year_start()
    current_period_label = _current_review_period()
    periods = [
        {**period, "is_current": period["label"] == current_period_label}
        for period in _performance_cycle_review_periods(start_year)
    ]
    return {
        "performance_cycle_id": _performance_cycle_id(start_year),
        "name": _performance_cycle_id(start_year),
        "review_periods": periods,
    }


class LoginRequest(BaseModel):
    username: str
    password: str  # base64-encoded by the frontend before sending


class SubmitFormRequest(BaseModel):
    answers: Dict[str, Any]


class SaveDraftRequest(BaseModel):
    answers: Dict[str, Any]


class SetApprovalRequest(BaseModel):
    status: Literal["approved", "rejected"]
    # Required when status is "rejected" (enforced in set_form_approval, not
    # here — Pydantic has no clean cross-field "required if" for this).
    # Optional at the model level only so approval keeps working without
    # callers needing to pass anything extra.
    reason: Optional[str] = None


class CreateEmployeeRequest(BaseModel):
    name: str
    work_email: str
    employee_id: str
    designation: str = ""
    department: str = ""
    location: str = ""
    # employee_id of this employee's manager — stored as this employee's own
    # assigned_employees array (see fetch_assigned_employees in
    # assesment_form.py: that field lives on the report's document, not the
    # manager's). None/omitted means "no manager assigned".
    manager_employee_id: Optional[str] = None


class UpdateEmployeeRequest(BaseModel):
    name: str
    work_email: str
    designation: str = ""
    department: str = ""
    location: str = ""
    manager_employee_id: Optional[str] = None


def _get_current_user(authorization: Optional[str]) -> Dict[str, Any]:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")

    token = authorization.split(" ", 1)[1]
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return {
        "email": payload["email"],
        "name": payload["name"],
        "is_hr": bool(payload.get("is_hr", False)),
        "is_cdo": bool(payload.get("is_cdo", False)),
    }


# Session length is now controlled solely by the frontend's 1-hour inactivity
# timeout (see sessionTimeout.ts), not by a token expiry — but the frontend's
# own JWT validation (jwtUtils.ts) treats a token with no `exp` claim at all
# as invalid, not as "never expires", so `exp` can't simply be omitted. A
# 10-year expiry is the practical equivalent of "no cap": it satisfies that
# validation while never actually being the thing that ends a session.
TOKEN_LIFETIME_SECONDS = 10 * 365 * 24 * 60 * 60


def _issue_token(
    *,
    email: str,
    name: str,
    designation: str = "",
    department: str = "",
    employee_id: str = "",
    has_team: bool = False,
    is_hr: bool = False,
    is_cdo: bool = False,
) -> str:
    now = int(time.time())
    return jwt.encode(
        {
            "email": email,
            "name": name,
            "designation": designation,
            "department": department,
            "employee_id": employee_id,
            "has_team": has_team,
            "is_hr": is_hr,
            "is_cdo": is_cdo,
            "view": True,
            "edit": True,
            "settings": True,
            "iat": now,
            "exp": now + TOKEN_LIFETIME_SECONDS,
        },
        JWT_SECRET,
        algorithm="HS256",
    )


@app.post("/login")
async def login(payload: LoginRequest, request: Request):
    try:
        decoded_password = base64.b64decode(payload.password).decode("utf-8")
    except Exception:
        decoded_password = payload.password

    users_container = request.app.state.users_container
    user = await fetch_user_by_email(users_container, payload.username)

    if user is None or not user.password_hash:
        return {
            "success": False,
            "message": "Invalid username or password"
        }

    if not bcrypt.checkpw(
        decoded_password.encode("utf-8"),
        user.password_hash.encode("utf-8")
    ):
        return {
            "success": False,
            "message": "Invalid username or password"
        }

    token = _issue_token(
        email=user.work_email,
        name=user.name,
        designation=user.designation or "",
        department=user.department or "",
        employee_id=user.employee_id or "",
        has_team=bool(user.employee_id)
        and len(
            await fetch_assigned_employees(users_container, user.employee_id)
        ) > 0,
        is_hr=(user.designation or "") in HR_DESIGNATIONS,
        is_cdo=(user.designation or "") == CDO_DESIGNATION,
    )

    return {
        "success": True,
        "message": "Login successful",
        "token": token,
        "expires_in": TOKEN_LIFETIME_SECONDS,
    }

def _load_questions(row):
    # row.questions comes from the startup-time templates cache, shared
    # across every request — copy before mutating (sort + injected
    # question_number/options) so this never corrupts the cached template.
    questions = [dict(q) for q in row.questions]
    questions.sort(key=lambda q: q["order"])
    for number, question in enumerate(questions, start=1):
        question["question_number"] = number
        if question.get("question") == "Review Period":
            start_year = _current_academic_year_start()
            question["options"] = [
                f"July {start_year} - December {start_year}",
                f"January {start_year + 1} - June {start_year + 1}",
            ]
    return questions


async def _resolve_target_employee(users_container, user: Dict[str, Any], employee_id: Optional[str]) -> Dict[str, str]:
    # Who is this submission *about*? Self by default (self-assessment always
    # works this way). When `employee_id` is given, there are two ways a
    # caller can be authorized to act on that employee's identity instead of
    # their own:
    #   1. A manager evaluating one of their own reports (existing behavior,
    #      unchanged) — verified via the same assigned-employees lookup the
    #      /team endpoint already trusts.
    #   2. HR, who can act on ANY employee (needed so HR can view/edit any
    #      submission from the HR Dashboard) — resolved directly by
    #      employee_id rather than requiring a manager relationship.
    if employee_id is None:
        return {"email": user["email"], "name": user["name"]}

    if user.get("is_hr"):
        employee = await fetch_user_by_employee_id(users_container, employee_id)
        if employee is None:
            raise HTTPException(status_code=404, detail="No employee found with that ID.")
        return {"email": employee.work_email, "name": employee.name}

    manager = await fetch_user_by_email(users_container, user["email"])
    if manager is None or not manager.employee_id:
        raise HTTPException(status_code=403, detail="You do not have any assigned employees.")

    for employee in await fetch_assigned_employees(users_container, manager.employee_id):
        if employee.employee_id == employee_id:
            return {"email": employee.work_email, "name": employee.name}

    raise HTTPException(status_code=403, detail="This employee is not assigned to you.")


@app.get("/api/employees/results")
async def get_my_profile(request: Request, authorization: Optional[str] = Header(default=None)):
    # Everything the employee Dashboard (DashboardContent.tsx) and
    # MyReviewDetails.tsx need about the caller's own review status, in one
    # round trip — those two pages used to make 6+ separate requests each
    # (a getFormTemplate + getFormSubmission pair per template, just to learn
    # each one's "Review Period" question_number and current submission), each
    # paying its own connection overhead on top of the query itself. Shape
    # mirrors get_hr_employees' per-employee fields (self_assessment/
    # manager_evaluation/hr_evaluation) so both callers can share the exact
    # same period-matching logic already written for HR's pages, just against
    # a single employee instead of the whole roster.
    user = _get_current_user(authorization)
    users_container = request.app.state.users_container
    submissions_container = request.app.state.submissions_container
    drafts_container = request.app.state.drafts_container
    templates_cache = request.app.state.templates_cache

    me = await fetch_user_by_email(users_container, user["email"])
    manager_ids = _manager_employee_ids(me.assigned_employees) if me is not None else []
    manager_names = []
    for manager_id in manager_ids:
        manager = await fetch_user_by_employee_id(users_container, manager_id)
        if manager is not None:
            manager_names.append(manager.name)

    self_form_row = await fetch_form_by_template_id(templates_cache, SELF_EVALUATION_TEMPLATE_ID)
    manager_form_row = await fetch_form_by_template_id(templates_cache, MANAGER_EVALUATION_TEMPLATE_ID)
    hr_form_row = await fetch_form_by_template_id(templates_cache, HR_EVALUATION_TEMPLATE_ID)
    self_questions = _load_questions(self_form_row)
    self_review_period_qn = _review_period_question_number(self_questions)
    manager_review_period_qn = _review_period_question_number(_load_questions(manager_form_row))
    hr_review_period_qn = _review_period_question_number(_load_questions(hr_form_row))

    current_review_period_id = _current_review_period_id()
    self_submission = await fetch_submission(
        submissions_container, SELF_EVALUATION_TEMPLATE_ID, user["email"], current_review_period_id
    )
    manager_submission = await fetch_submission(
        submissions_container, MANAGER_EVALUATION_TEMPLATE_ID, user["email"], current_review_period_id
    )
    hr_submission = await fetch_submission(
        submissions_container, HR_EVALUATION_TEMPLATE_ID, user["email"], current_review_period_id
    )
    # No _load_questions/review-period lookup for this one — its one
    # question ("Additional Comments") isn't a "Review Period" question, so
    # there's no submitted answer to resolve a period from — but the
    # submission itself is still scoped to the current period like every
    # other template (see _review_period_id_for_template).
    overall_submission = await fetch_submission(
        submissions_container, OVERALL_REVIEW_TEMPLATE_ID, user["email"], current_review_period_id
    )
    # Only meaningful while there's no real submission yet — once submitted,
    # submit_form has already deleted whatever draft existed for this exact
    # period.
    self_draft = (
        None
        if self_submission is not None
        else await fetch_draft(drafts_container, SELF_EVALUATION_TEMPLATE_ID, user["email"], current_review_period_id)
    )

    return {
        "manager_name": ", ".join(manager_names) if manager_names else None,
        "performance_cycle": _current_performance_cycle(),
        "self_assessment": {
            "submitted": self_submission is not None,
            "submitted_at": self_submission.submitted_at if self_submission is not None else None,
            "review_period": _submission_review_period(self_submission, self_review_period_qn),
            "has_draft": self_draft is not None,
        },
        # Full questions + submitted answers — not just status — for the two
        # places that need to actually render or fill out this exact form:
        # MyReviewDetails' "Self Review" tab, and the Dashboard's own inline
        # "Start Assessment"/"Continue" form. Folded in here since
        # self_form_row/self_submission above are already fetched for
        # self_assessment's summary fields, so this costs zero extra queries.
        # Shaped identically to get_form_with_submission's own response
        # ({template, submission}) so either caller can hand it straight to
        # useSectionedFormTemplate/HRSelfAssessmentTab as preloaded data
        # instead of that hook/component fetching GET /api/forms/1001/full
        # itself a moment later.
        "self_assessment_form": {
            "template": {
                "template_id": self_form_row.template_id,
                "type": self_form_row.type,
                "title": f"{self_form_row.title} ({_current_academic_year()})",
                "header_title": self_form_row.header_title,
                "questions": self_questions,
                "styles": FORM_STYLES,
                "review_period": _current_review_period(),
                "performance_cycle": _current_performance_cycle(),
            },
            "submission": (
                {
                    "submitted": True,
                    "answers": self_submission.answers,
                    "submitted_at": self_submission.submitted_at,
                    "employee_name": me.name if me is not None else None,
                }
                if self_submission is not None
                else {
                    "submitted": False,
                    "employee_name": me.name if me is not None else None,
                    "draft_answers": self_draft.answers if self_draft is not None else None,
                }
            ),
        },
        "manager_evaluation": {
            "submitted": manager_submission is not None,
            "submitted_at": manager_submission.submitted_at if manager_submission is not None else None,
            "review_period": _submission_review_period(manager_submission, manager_review_period_qn),
        },
        "hr_evaluation": {
            "submitted": hr_submission is not None,
            "submitted_at": hr_submission.submitted_at if hr_submission is not None else None,
            "review_period": _submission_review_period(hr_submission, hr_review_period_qn),
        },
        "overall_review": {
            "submitted": overall_submission is not None,
            "submitted_at": overall_submission.submitted_at if overall_submission is not None else None,
        },
    }


@app.get("/api/forms/{template_id}/submission")
async def get_submission(
    template_id: int,
    request: Request,
    employee_id: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
):
    user = _get_current_user(authorization)
    users_container = request.app.state.users_container
    submissions_container = request.app.state.submissions_container

    target = await _resolve_target_employee(users_container, user, employee_id)
    row = await fetch_submission(
        submissions_container, template_id, target["email"], _review_period_id_for_template(template_id)
    )

    if row is None:
        return {"submitted": False, "employee_name": target["name"]}

    return {
        "submitted": True,
        "answers": row.answers,
        "submitted_at": row.submitted_at,
        "employee_name": target["name"],
        "approval_status": getattr(row, "approval_status", None),
        "approval_by": getattr(row, "approval_by", None),
        "approval_at": getattr(row, "approval_at", None),
        "history": getattr(row, "history", []),
    }


@app.get("/api/forms/{template_id}/full")
async def get_form_with_submission(
    template_id: int,
    request: Request,
    employee_id: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
):
    # Every caller that needs a form's questions also needs to know what (if
    # anything) was already submitted for it — useSectionedFormTemplate (the
    # fill-in form hook), HRSelfAssessmentTab, and OverallReviewTab all used
    # to call get_form + get_submission above as a pair just to get both
    # halves of the same picture every single time. One response covers both.
    # get_form/get_submission above are left in place for any caller that
    # only ever needs one half.
    user = _get_current_user(authorization)
    users_container = request.app.state.users_container
    submissions_container = request.app.state.submissions_container
    drafts_container = request.app.state.drafts_container
    templates_cache = request.app.state.templates_cache

    row = await fetch_form_by_template_id(templates_cache, template_id)
    if row is None:
        raise HTTPException(status_code=404, detail=f"No form found for template_id: {template_id}")

    target = await _resolve_target_employee(users_container, user, employee_id)
    review_period_id = _review_period_id_for_template(template_id)
    submission_row = await fetch_submission(submissions_container, template_id, target["email"], review_period_id)

    template = {
        "template_id": row.template_id,
        "type": row.type,
        "title": f"{row.title} ({_current_academic_year()})",
        "header_title": row.header_title,
        "questions": _load_questions(row),
        "styles": FORM_STYLES,
        "review_period": _current_review_period(),
        "performance_cycle": _current_performance_cycle(),
    }
    if submission_row is None:
        draft_row = await fetch_draft(drafts_container, template_id, target["email"], review_period_id)
        submission = {
            "submitted": False,
            "employee_name": target["name"],
            "draft_answers": draft_row.answers if draft_row is not None else None,
        }
    else:
        submission = {
            "submitted": True,
            "answers": submission_row.answers,
            "submitted_at": submission_row.submitted_at,
            "employee_name": target["name"],
            "approval_status": getattr(submission_row, "approval_status", None),
            "approval_by": getattr(submission_row, "approval_by", None),
            "approval_at": getattr(submission_row, "approval_at", None),
            "history": getattr(submission_row, "history", []),
        }

    return {"template": template, "submission": submission}


@app.put("/api/forms/{template_id}/draft")
async def save_draft(
    template_id: int,
    payload: SaveDraftRequest,
    request: Request,
    employee_id: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
):
    # Best-effort autosave, addressed exactly like the submission it'll
    # eventually become (same _resolve_target_employee resolution submit_form
    # uses) — no workflow gates here, since a draft has no side effects
    # (no notifications, no approval logic, nothing else reads it except the
    # same person resuming this same form).
    user = _get_current_user(authorization)
    users_container = request.app.state.users_container
    drafts_container = request.app.state.drafts_container

    target = await _resolve_target_employee(users_container, user, employee_id)
    review_period_id = _review_period_id_for_template(template_id)
    await upsert_draft(drafts_container, template_id, target["email"], payload.answers, review_period_id)
    return {"success": True}


async def _queue_submission_notifications(
    template_id: int,
    target: Dict[str, str],
    user: Dict[str, Any],
    users_container,
    background_tasks: BackgroundTasks,
) -> None:
    # Resolving recipients happens here (awaited, so it's part of the
    # request), but the actual email send is queued as a BackgroundTask —
    # it runs after the response is returned, so a slow/unreachable SendGrid
    # never delays the submission response. Wrapped in its own try/except on
    # top of email_service's internal one: a failure resolving recipients
    # (e.g. a Cosmos hiccup) must never surface as a failure of the
    # submission itself, which has already succeeded by the time this runs.
    try:
        review_period = _current_review_period()
        if template_id == SELF_EVALUATION_TEMPLATE_ID:
            employee = await fetch_user_by_email(users_container, target["email"])
            manager_ids = _manager_employee_ids(employee.assigned_employees) if employee is not None else []
            for manager_id in manager_ids:
                manager = await fetch_user_by_employee_id(users_container, manager_id)
                if manager is not None:
                    background_tasks.add_task(
                        email_service.send_review_submitted_email,
                        to_email=manager.work_email,
                        to_name=manager.name,
                        employee_name=target["name"],
                        review_period=review_period,
                        template_id=template_id,
                        submitted_by=user["name"],
                    )
        elif template_id in (MANAGER_EVALUATION_TEMPLATE_ID, HR_EVALUATION_TEMPLATE_ID):
            designation = SENIOR_HR_DESIGNATION if template_id == MANAGER_EVALUATION_TEMPLATE_ID else CDO_DESIGNATION
            recipients = await fetch_users_by_designation(users_container, designation)
            for recipient in recipients:
                background_tasks.add_task(
                    email_service.send_review_submitted_email,
                    to_email=recipient.work_email,
                    to_name=recipient.name,
                    employee_name=target["name"],
                    review_period=review_period,
                    template_id=template_id,
                    submitted_by=user["name"],
                )
        elif template_id == OVERALL_REVIEW_TEMPLATE_ID:
            background_tasks.add_task(
                email_service.send_overall_review_complete_email,
                to_email=target["email"],
                to_name=target["name"],
                review_period=review_period,
                approved_by=user["name"],
            )
    except Exception:
        logger.exception("Failed to queue submission notification for template_id=%s", template_id)


@app.post("/api/forms/{template_id}/submit")
async def submit_form(
    template_id: int,
    payload: SubmitFormRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    employee_id: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
):
    user = _get_current_user(authorization)

    # HR Evaluation is never self-service — only HR submits it, and always
    # about a specific employee (there's no "fill out my own HR Evaluation"
    # concept, unlike Self Assessment). The CDO shares HR's is_hr flag (see
    # HR_DESIGNATIONS above) so they can view this tab, but they're
    # deliberately excluded here — CDO gets read-only access to HR Evaluation,
    # mirrored client-side by canEditHR in HREvaluationTab.tsx, so this isn't
    # just a client-side check. Checked before touching the DB at all.
    if template_id == HR_EVALUATION_TEMPLATE_ID and not (
        user.get("is_hr") and not user.get("is_cdo") and employee_id is not None
    ):
        raise HTTPException(status_code=403, detail="Only HR can submit an HR Evaluation, for a specific employee.")

    # Overall Review approval is CDO-only — stricter than HR Evaluation
    # (is_hr also covers regular HR designations; is_cdo does not), and
    # always about a specific employee, same reasoning as above.
    if template_id == OVERALL_REVIEW_TEMPLATE_ID and not (user.get("is_cdo") and employee_id is not None):
        raise HTTPException(status_code=403, detail="Only the CDO can approve the Overall Review, for a specific employee.")

    users_container = request.app.state.users_container
    submissions_container = request.app.state.submissions_container
    drafts_container = request.app.state.drafts_container
    current_review_period_id = _current_review_period_id()

    target = await _resolve_target_employee(users_container, user, employee_id)

    # Workflow gate, enforced here (not just in the UI): HR Evaluation
    # can't be created until this employee's Self Assessment and Manager
    # Evaluation both have a real submission FOR THE CURRENT PERIOD — mirrors
    # hrEvaluationAvailable in HREmployeeDetails.tsx, just re-checked
    # server-side so the gate can't be bypassed by calling this endpoint
    # directly.
    if template_id == HR_EVALUATION_TEMPLATE_ID:
        self_submission = await fetch_submission(
            submissions_container, SELF_EVALUATION_TEMPLATE_ID, target["email"], current_review_period_id
        )
        manager_submission = await fetch_submission(
            submissions_container, MANAGER_EVALUATION_TEMPLATE_ID, target["email"], current_review_period_id
        )
        if self_submission is None or manager_submission is None:
            raise HTTPException(
                status_code=400,
                detail="Self Assessment and Manager Evaluation must both be submitted before HR Evaluation.",
            )

    # Same idea, one step later: the Overall Review can't be approved
    # until the HR Evaluation itself has a real submission for the current
    # period.
    if template_id == OVERALL_REVIEW_TEMPLATE_ID:
        hr_submission = await fetch_submission(
            submissions_container, HR_EVALUATION_TEMPLATE_ID, target["email"], current_review_period_id
        )
        if hr_submission is None:
            raise HTTPException(
                status_code=400,
                detail="HR Evaluation must be submitted before the Overall Review can be approved.",
            )

    review_period_id = _review_period_id_for_template(template_id)
    existing = await fetch_submission(submissions_container, template_id, target["email"], review_period_id)

    if existing is not None:
        # Every submission is otherwise permanent for its review period —
        # this is the one carve-out, and only for HR explicitly acting on a
        # specific employee_id (never for someone editing their own
        # submission, which still 409s exactly as before). Manager
        # Evaluation is excluded from this HR carve-out entirely — HR can no
        # longer edit a manager's evaluation directly (mirrored client-side
        # by HRManagerEvaluationTab.tsx no longer offering an Edit action).
        can_edit_existing = (
            user.get("is_hr") and employee_id is not None and template_id != MANAGER_EVALUATION_TEMPLATE_ID
        )
        # The one way a Manager Evaluation becomes editable again: HR/CDO
        # explicitly rejected it (see set_form_approval below), and the
        # caller is the SAME manager who owns this report — never HR, whose
        # own carve-out for this template is excluded just above.
        # _resolve_target_employee's non-HR branch already verifies
        # employee_id names one of this caller's own assigned reports, so
        # this can't be used to edit anyone else's evaluation.
        if (
            template_id == MANAGER_EVALUATION_TEMPLATE_ID
            and not user.get("is_hr")
            and getattr(existing, "approval_status", None) == "rejected"
        ):
            can_edit_existing = True
        if can_edit_existing:
            await update_form_submission(
                submissions_container, template_id, target["email"], payload.answers, review_period_id,
                actor_name=user["name"],
            )
            await delete_draft(drafts_container, template_id, target["email"], review_period_id)
            await _queue_submission_notifications(template_id, target, user, users_container, background_tasks)
            return {"success": True, "message": "Form updated successfully"}
        raise HTTPException(status_code=409, detail="You have already submitted this form.")

    await insert_form_submission(
        submissions_container, template_id, target["email"], target["name"], payload.answers, review_period_id,
        actor_name=user["name"],
    )
    await delete_draft(drafts_container, template_id, target["email"], review_period_id)
    await _queue_submission_notifications(template_id, target, user, users_container, background_tasks)
    return {"success": True, "message": "Form submitted successfully"}


@app.post("/api/forms/{template_id}/approval")
async def set_form_approval(
    template_id: int,
    payload: SetApprovalRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    employee_id: str,
    authorization: Optional[str] = Header(default=None),
):
    # HR/CDO's decision on an already-submitted Manager Evaluation — the only
    # template with an approve/reject workflow today. is_hr already covers
    # the CDO designation (see HR_DESIGNATIONS above), so no separate is_cdo
    # check is needed to let the CDO act here too.
    user = _get_current_user(authorization)
    if template_id != MANAGER_EVALUATION_TEMPLATE_ID:
        raise HTTPException(status_code=404, detail="Approval is not supported for this form.")
    if not user.get("is_hr"):
        raise HTTPException(status_code=403, detail="Only HR can approve or reject a Manager Evaluation.")
    # Enforced here, not just by the Reject modal client-side, so a direct
    # API call can't record a rejection with no reason either.
    if payload.status == "rejected" and not (payload.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required to reject a Manager Evaluation.")

    users_container = request.app.state.users_container
    submissions_container = request.app.state.submissions_container
    # is_hr resolves any employee_id directly (see _resolve_target_employee) —
    # this isn't restricted to a manager acting on their own reports.
    target = await _resolve_target_employee(users_container, user, employee_id)

    review_period_id = _review_period_id_for_template(template_id)
    existing = await fetch_submission(submissions_container, template_id, target["email"], review_period_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="No Manager Evaluation submission found for this employee.")

    await set_submission_approval(
        submissions_container, template_id, target["email"], review_period_id, payload.status, user["name"],
        payload.reason,
    )

    if payload.status == "rejected":
        # Previously silent (see REQUIREMENTS.md §13): rejecting a Manager
        # Evaluation is the single most time-sensitive event in the
        # workflow, but until now the manager could only discover it by
        # checking the app. Mirrors the recipient-lookup pattern used for
        # the Self Review "submitted" notification in
        # _queue_submission_notifications above — resolved and awaited here
        # (part of the request), the actual send queued as a background
        # task so a slow/unreachable SendGrid never delays the response.
        try:
            employee = await fetch_user_by_email(users_container, target["email"])
            manager_ids = _manager_employee_ids(employee.assigned_employees) if employee is not None else []
            review_period = _current_review_period()
            for manager_id in manager_ids:
                manager = await fetch_user_by_employee_id(users_container, manager_id)
                if manager is not None:
                    background_tasks.add_task(
                        email_service.send_manager_review_rejected_email,
                        to_email=manager.work_email,
                        to_name=manager.name,
                        employee_name=target["name"],
                        review_period=review_period,
                        template_id=template_id,
                        rejected_by=user["name"],
                        reason=payload.reason or "",
                    )
        except Exception:
            logger.exception("Failed to queue rejection notification for template_id=%s", template_id)

    return {"success": True, "message": f"Manager Evaluation {payload.status}"}


@app.get("/api/manager/team")
async def get_manager_team(request: Request, authorization: Optional[str] = Header(default=None)):
    # ManagerEvaluationsList (the "Manager Review" list) and ManagerEmployeeReview
    # (its per-employee detail page) each used to call get_team_submissions
    # above TWICE — once for template 1001 (Self Assessment), once for 1002
    # (Manager Evaluation) — to build one table with both status columns. Same
    # per-employee queries either way; this just does both template's worth of
    # them behind one HTTP round trip instead of two, and returns them in the
    # exact same `team`-array shape those two calls already produced, so
    # callers only need to stop making the second request rather than
    # restructure how they consume the response.
    user = _get_current_user(authorization)
    users_container = request.app.state.users_container
    submissions_container = request.app.state.submissions_container
    drafts_container = request.app.state.drafts_container
    templates_cache = request.app.state.templates_cache

    manager = await fetch_user_by_email(users_container, user["email"])
    if manager is None or not manager.employee_id:
        empty = {"team": [], "review_period": _current_review_period(), "review_periods": [_current_review_period()]}
        return {"self_team": empty, "manager_team": empty}

    self_form_row = await fetch_form_by_template_id(templates_cache, SELF_EVALUATION_TEMPLATE_ID)
    manager_form_row = await fetch_form_by_template_id(templates_cache, MANAGER_EVALUATION_TEMPLATE_ID)
    manager_questions = _load_questions(manager_form_row)
    self_review_period_qn = _review_period_question_number(_load_questions(self_form_row))
    manager_review_period_qn = _review_period_question_number(manager_questions)

    current_review_period_id = _current_review_period_id()
    self_team = []
    manager_team = []
    self_review_periods_seen = {_current_review_period()}
    manager_review_periods_seen = {_current_review_period()}
    for employee in await fetch_assigned_employees(users_container, manager.employee_id):
        base_entry = {
            "employee_id": employee.employee_id,
            "name": employee.name,
            "email": employee.work_email,
            "designation": employee.designation or None,
            "department": employee.department or None,
        }

        self_submission = await fetch_submission(
            submissions_container, SELF_EVALUATION_TEMPLATE_ID, employee.work_email, current_review_period_id
        )
        self_entry = dict(base_entry, submitted=self_submission is not None)
        if self_submission is not None:
            self_entry["submitted_at"] = self_submission.submitted_at
            review_period = _submission_review_period(self_submission, self_review_period_qn)
            self_entry["review_period"] = review_period
            if review_period:
                self_review_periods_seen.add(review_period)
        self_team.append(self_entry)

        manager_submission = await fetch_submission(
            submissions_container, MANAGER_EVALUATION_TEMPLATE_ID, employee.work_email, current_review_period_id
        )
        manager_entry = dict(base_entry, submitted=manager_submission is not None)
        if manager_submission is not None:
            manager_entry["submitted_at"] = manager_submission.submitted_at
            review_period = _submission_review_period(manager_submission, manager_review_period_qn)
            manager_entry["review_period"] = review_period
            if review_period:
                manager_review_periods_seen.add(review_period)
            manager_entry.update(_score_submission(manager_questions, manager_submission.answers))
        else:
            manager_draft = await fetch_draft(
                drafts_container, MANAGER_EVALUATION_TEMPLATE_ID, employee.work_email, current_review_period_id
            )
            manager_entry["has_draft"] = manager_draft is not None
        manager_team.append(manager_entry)

    return {
        "self_team": {
            "team": self_team,
            "review_period": _current_review_period(),
            "review_periods": sorted(self_review_periods_seen, key=_review_period_sort_key),
        },
        "manager_team": {
            "team": manager_team,
            "review_period": _current_review_period(),
            "review_periods": sorted(manager_review_periods_seen, key=_review_period_sort_key),
        },
    }


def _review_period_question_number(questions) -> Optional[int]:
    # Same technique already used for the Employee Dashboard's "My
    # Assessments" section: the only link a submission has to a specific
    # period is its own answer to the "Review Period" question, not
    # submitted_at (an employee could submit late) and not a stored column
    # (there isn't one). Resolving this once per template, rather than per
    # submission, since every submission of the same template shares the
    # same question_number for it.
    for question in questions:
        if question.get("question") == "Review Period":
            return question["question_number"]
    return None


def _submission_review_period(submission, review_period_question_number: Optional[int]) -> Optional[str]:
    if submission is None or review_period_question_number is None:
        return None
    return submission.answers.get(str(review_period_question_number))


def _hr_evaluation_eligible(
    self_review_period: Optional[str],
    manager_review_period: Optional[str],
    target_review_period: Optional[str],
) -> bool:
    # Workflow gate: HR Evaluation can only be created, saved as a draft, or
    # submitted for a given employee + review period once BOTH the Self
    # Assessment and the Manager Evaluation have a submission whose own
    # "Review Period" answer matches that exact target period — same matching
    # rule _submission_review_period already establishes for every other
    # period-aware comparison in this file.
    #
    # There is currently no HR Evaluation template (no template_id 1003) and
    # no create/save-draft/submit endpoint for it — those are paused pending
    # real question content, so nothing calls this function yet. It exists
    # now so that whichever endpoints are added later enforce this exact
    # rule server-side, rather than relying on the frontend tab merely being
    # disabled. When target_review_period is None (HR viewing "All Periods",
    # no specific period selected), eligibility falls back to "both were
    # submitted for some period" rather than requiring an exact match.
    if target_review_period is None:
        return self_review_period is not None and manager_review_period is not None
    return self_review_period == target_review_period and manager_review_period == target_review_period


def _manager_employee_ids(assigned_employees: Optional[List[str]]) -> list:
    # assigned_employees lives on the EMPLOYEE's own document and lists the
    # employee_id(s) of their manager(s) (see fetch_assigned_employees in
    # assesment_form.py). Cosmos stores this as a native array (or it may be
    # absent/None for an employee with no manager) — no parsing needed.
    return assigned_employees if isinstance(assigned_employees, list) else []


@app.get("/api/hr/employees")
async def get_hr_employees(request: Request, authorization: Optional[str] = Header(default=None)):
    # Read-only roster — unlike the three mutation endpoints below (which stay HR-only, not
    # CDO), the CDO needs this same listing to reach an employee's Overall Review tab from the
    # HR Dashboard. is_hr already covers CDO (see HR_DESIGNATIONS above), so no separate is_cdo
    # check is needed to let them read this too; CDO already has equivalent per-employee read
    # access via GET /api/forms/{template_id}/full?employee_id=... (is_hr resolves any
    # employee_id there too), so this doesn't expose any data category that wasn't already
    # reachable one employee at a time — it just lets CDO browse the same list HR sees.
    user = _get_current_user(authorization)
    if not user["is_hr"]:
        raise HTTPException(status_code=403, detail="HR access required.")

    users_container = request.app.state.users_container
    submissions_container = request.app.state.submissions_container
    templates_cache = request.app.state.templates_cache

    all_employees = await fetch_all_employees(users_container, user["email"])
    # A manager is just another row in this same org-wide roster, so this
    # reuses the list already fetched above rather than a second query —
    # maps employee_id -> name for resolving assigned_employees into a
    # display name below.
    name_by_employee_id = {e.employee_id: e.name for e in all_employees if e.employee_id}

    # Resolved once per template (not per employee/submission) — every
    # submission of the same template shares the same "Review Period"
    # question_number.
    self_form_row = await fetch_form_by_template_id(templates_cache, SELF_EVALUATION_TEMPLATE_ID)
    manager_form_row = await fetch_form_by_template_id(templates_cache, MANAGER_EVALUATION_TEMPLATE_ID)
    hr_form_row = await fetch_form_by_template_id(templates_cache, HR_EVALUATION_TEMPLATE_ID)
    manager_questions = _load_questions(manager_form_row)
    hr_questions = _load_questions(hr_form_row)
    self_review_period_qn = _review_period_question_number(_load_questions(self_form_row))
    manager_review_period_qn = _review_period_question_number(manager_questions)
    hr_review_period_qn = _review_period_question_number(hr_questions)

    employees = []
    # Distinct managers who actually have at least one report — built
    # while resolving each employee's manager(s) below, not a separate
    # query, and keyed by employee_id so duplicate names can't collide.
    managers_by_id: Dict[str, str] = {}
    # Every review period actually referenced by a real submission,
    # org-wide — never invented, and always includes the current period
    # even if nobody has submitted for it yet, so it's still selectable.
    review_periods_seen = {_current_review_period()}
    current_review_period_id = _current_review_period_id()
    for employee in all_employees:
        # One single-partition query per employee (partitioned by
        # employee_email) returns the current period's 1001/1002/1003/1004
        # submissions in one round trip, replacing 4 separate point reads.
        submissions_by_template = await fetch_submissions_for_employee(
            submissions_container, employee.work_email, current_review_period_id
        )
        self_submission = submissions_by_template.get(SELF_EVALUATION_TEMPLATE_ID)
        manager_submission = submissions_by_template.get(MANAGER_EVALUATION_TEMPLATE_ID)
        hr_submission = submissions_by_template.get(HR_EVALUATION_TEMPLATE_ID)
        # No _load_questions/review-period lookup for this one — its one
        # question ("Additional Comments") isn't a "Review Period" question,
        # so there'd be nothing to resolve from a submitted answer — but the
        # submission itself is still scoped to the current period, same as
        # every other template (see _review_period_id_for_template).
        overall_submission = submissions_by_template.get(OVERALL_REVIEW_TEMPLATE_ID)

        manager_ids = _manager_employee_ids(employee.assigned_employees)
        # Falls back to the raw employee_id (rather than hiding it) if a
        # manager's own row wasn't in this roster — e.g. if the HR caller
        # themselves is that manager, since fetch_all_employees excludes
        # the caller's own row.
        manager_names = [name_by_employee_id.get(mid, mid) for mid in manager_ids]
        for manager_id, manager_name in zip(manager_ids, manager_names):
            managers_by_id[manager_id] = manager_name

        self_review_period = _submission_review_period(self_submission, self_review_period_qn)
        manager_review_period = _submission_review_period(manager_submission, manager_review_period_qn)
        hr_review_period = _submission_review_period(hr_submission, hr_review_period_qn)
        review_periods_seen.update(p for p in (self_review_period, manager_review_period, hr_review_period) if p)

        employees.append({
            "employee_id": employee.employee_id,
            "name": employee.name,
            "email": employee.work_email,
            "designation": employee.designation or None,
            "department": employee.department or None,
            "location": employee.location or None,
            "manager_ids": manager_ids,
            "manager_name": ", ".join(manager_names) if manager_names else None,
            "self_assessment": {
                "submitted": self_submission is not None,
                "submitted_at": self_submission.submitted_at if self_submission is not None else None,
                "review_period": self_review_period,
            },
            "manager_evaluation": {
                "submitted": manager_submission is not None,
                "submitted_at": manager_submission.submitted_at if manager_submission is not None else None,
                "has_manager": bool(manager_ids),
                "review_period": manager_review_period,
                "score_percentage": _score_percentage(manager_questions, manager_submission),
            },
            "hr_evaluation": {
                "submitted": hr_submission is not None,
                "submitted_at": hr_submission.submitted_at if hr_submission is not None else None,
                "review_period": hr_review_period,
                "score_percentage": _score_percentage(hr_questions, hr_submission),
            },
            "overall_review": {
                "submitted": overall_submission is not None,
                "submitted_at": overall_submission.submitted_at if overall_submission is not None else None,
            },
        })

    return {
        "review_period": _current_review_period(),
        "review_periods": sorted(review_periods_seen, key=_review_period_sort_key),
        "managers": [
            {"employee_id": manager_id, "name": manager_name}
            for manager_id, manager_name in sorted(managers_by_id.items(), key=lambda item: item[1])
        ],
        "employees": employees,
    }


@app.post("/api/hr/employees")
async def create_employee(payload: CreateEmployeeRequest, request: Request, authorization: Optional[str] = Header(default=None)):
    user = _get_current_user(authorization)
    if not user["is_hr"] or user["is_cdo"]:
        raise HTTPException(status_code=403, detail="HR access required.")

    if payload.manager_employee_id == payload.employee_id:
        raise HTTPException(status_code=400, detail="An employee cannot be their own manager.")

    users_container = request.app.state.users_container

    if await fetch_user_by_email(users_container, payload.work_email) is not None:
        raise HTTPException(status_code=409, detail="An employee with this email already exists.")
    if await fetch_user_by_employee_id(users_container, payload.employee_id) is not None:
        raise HTTPException(status_code=409, detail="An employee with this Employee ID already exists.")
    if payload.manager_employee_id and await fetch_user_by_employee_id(users_container, payload.manager_employee_id) is None:
        raise HTTPException(status_code=400, detail="Selected manager does not exist.")

    assigned_employees = [payload.manager_employee_id] if payload.manager_employee_id else None
    await insert_employee(
        users_container,
        payload.name,
        payload.work_email,
        payload.employee_id,
        payload.designation,
        payload.department,
        payload.location,
        assigned_employees,
    )
    return {"success": True, "message": "Employee created successfully"}


@app.put("/api/hr/employees/{employee_id}")
async def update_employee_endpoint(
    employee_id: str,
    payload: UpdateEmployeeRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user = _get_current_user(authorization)
    if not user["is_hr"] or user["is_cdo"]:
        raise HTTPException(status_code=403, detail="HR access required.")

    if payload.manager_employee_id == employee_id:
        raise HTTPException(status_code=400, detail="An employee cannot be their own manager.")

    users_container = request.app.state.users_container

    if await fetch_user_by_employee_id(users_container, employee_id) is None:
        raise HTTPException(status_code=404, detail="Employee not found.")

    # A different employee already using the new email is only a
    # conflict if it isn't this same employee — an unchanged email must
    # still pass through untouched.
    email_owner = await fetch_user_by_email(users_container, payload.work_email)
    if email_owner is not None and email_owner.employee_id != employee_id:
        raise HTTPException(status_code=409, detail="Another employee already uses this email.")
    if payload.manager_employee_id and await fetch_user_by_employee_id(users_container, payload.manager_employee_id) is None:
        raise HTTPException(status_code=400, detail="Selected manager does not exist.")

    assigned_employees = [payload.manager_employee_id] if payload.manager_employee_id else None
    await update_employee(
        users_container,
        employee_id,
        payload.name,
        payload.work_email,
        payload.designation,
        payload.department,
        payload.location,
        assigned_employees,
    )
    return {"success": True, "message": "Employee updated successfully"}


@app.delete("/api/hr/employees/{employee_id}")
async def delete_employee_endpoint(employee_id: str, request: Request, authorization: Optional[str] = Header(default=None)):
    user = _get_current_user(authorization)
    if not user["is_hr"] or user["is_cdo"]:
        raise HTTPException(status_code=403, detail="HR access required.")

    users_container = request.app.state.users_container

    if await fetch_user_by_employee_id(users_container, employee_id) is None:
        raise HTTPException(status_code=404, detail="Employee not found.")

    # Strip this employee_id out of every report's assigned_employees
    # array before deleting the row itself, so no one is left pointing at
    # a manager that no longer exists (per requested delete behavior).
    for report in await fetch_employees_managed_by(users_container, employee_id):
        remaining = [mid for mid in (report.assigned_employees or []) if mid != employee_id]
        await update_assigned_employees(users_container, report.employee_id, remaining if remaining else None)

    await delete_employee(users_container, employee_id)
    return {"success": True, "message": "Employee deleted successfully"}
