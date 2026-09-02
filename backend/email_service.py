"""Notification emails for the review submission workflow.

Sending is best-effort: if SendGrid isn't configured, or the send call
itself fails, this logs and returns rather than raising — a notification
problem must never surface as a failure of the form submission it's
attached to. Callers in main.py queue these as FastAPI BackgroundTasks (run
after the response, in a threadpool, since SendGrid's client is a blocking
HTTP call, not async).
"""

import logging
import os
from datetime import datetime
from html import escape

logger = logging.getLogger("pms")

FORM_NAMES = {
    1001: "Self Review",
    1002: "Manager Review",
    1003: "HR Review",
}


def _send_via_sendgrid(
    api_key: str, from_email: str, to_email: str, subject: str, html_body: str, plain_text_body: str
) -> None:
    from sendgrid import SendGridAPIClient
    from sendgrid.helpers.mail import Mail

    # Sent multipart (both parts), and html_content is a well-formed document
    # (not just a bare fragment of <br>/<b> tags) — an HTML-only, fragment-body
    # message is a real spam-filter signal on major providers, independent of
    # sender domain authentication.
    message = Mail(
        from_email=from_email,
        to_emails=to_email,
        subject=subject,
        plain_text_content=plain_text_body,
        html_content=f"<html><body>{html_body}</body></html>",
    )
    SendGridAPIClient(api_key).send(message)


def _send(to_email: str, subject: str, html_body: str, plain_text_body: str) -> None:
    api_key = os.environ.get("SENDGRID_API_KEY")
    from_email = os.environ.get("SENDGRID_FROM_EMAIL")
    if not api_key or not from_email:
        logger.warning("SendGrid not configured — skipping notification email to %s", to_email)
        return

    try:
        _send_via_sendgrid(api_key, from_email, to_email, subject, html_body, plain_text_body)
    except Exception:
        logger.exception("Failed to send notification email via SendGrid to %s", to_email)


def send_review_submitted_email(
    *,
    to_email: str,
    to_name: str,
    employee_name: str,
    review_period: str,
    template_id: int,
    submitted_by: str,
) -> None:
    form_name = FORM_NAMES.get(template_id, "Review")
    submitted_date = datetime.now().strftime("%B %d, %Y")
    # Neutral/informational wording — "Action Required" + "log in" with no
    # actual link is a textbook phishing pattern (urgent language pushing a
    # login with nothing to click), which spam filters specifically watch
    # for independent of sender domain authentication.
    subject = f"New: {form_name} submitted for {employee_name}"
    # Dynamic values are escaped since they ultimately come from user-entered
    # names in Cosmos (an employee/manager's own name) — this is an HTML
    # email now (needed for bold), so an unescaped "<"/"&" in a name could
    # otherwise corrupt the markup.
    html_body = (
        f"Hi {escape(to_name)},<br><br>"
        f"{escape(form_name)} has been submitted for <b>{escape(employee_name)}</b> and is now ready for your review.<br><br>"
        "You can view the details in the Performance Management System.<br><br>"
        "<b>Review Details</b><br><br>"
        f"<b>Employee:</b> {escape(employee_name)}<br>"
        f"<b>Review Period:</b> {escape(review_period)}<br>"
        f"<b>Form:</b> {escape(form_name)}<br>"
        f"<b>Submitted By:</b> {escape(submitted_by)}<br>"
        f"<b>Submitted On:</b> {submitted_date}<br><br>"
        "Thanks,<br>"
        "Performance Management System"
    )
    # Same content as html_body, in plain text — SendGrid sends both parts
    # together (see _send_via_sendgrid), never just one.
    plain_text_body = (
        f"Hi {to_name},\n\n"
        f"{form_name} has been submitted for {employee_name} and is now ready for your review.\n\n"
        "You can view the details in the Performance Management System.\n\n"
        "Review Details\n\n"
        f"Employee: {employee_name}\n"
        f"Review Period: {review_period}\n"
        f"Form: {form_name}\n"
        f"Submitted By: {submitted_by}\n"
        f"Submitted On: {submitted_date}\n\n"
        "Thanks,\n"
        "Performance Management System"
    )
    _send(to_email, subject, html_body, plain_text_body)


def send_manager_review_rejected_email(
    *,
    to_email: str,
    to_name: str,
    employee_name: str,
    review_period: str,
    template_id: int,
    rejected_by: str,
    reason: str,
) -> None:
    # Distinct from send_review_submitted_email: this is HR/CDO's decision on
    # a submission the manager already made, not a new submission ready for
    # someone else's review — the manager needs to know their evaluation was
    # sent back and why, not that something is now "ready for their review".
    form_name = FORM_NAMES.get(template_id, "Review")
    rejected_date = datetime.now().strftime("%B %d, %Y")
    subject = f"Action Needed: {form_name} for {employee_name} was rejected"
    html_body = (
        f"Hi {escape(to_name)},<br><br>"
        f"Your {escape(form_name)} for <b>{escape(employee_name)}</b> was rejected and needs revision.<br><br>"
        "You can revise and resubmit it in the Performance Management System.<br><br>"
        "<b>Review Details</b><br><br>"
        f"<b>Employee:</b> {escape(employee_name)}<br>"
        f"<b>Review Period:</b> {escape(review_period)}<br>"
        f"<b>Form:</b> {escape(form_name)}<br>"
        f"<b>Rejected By:</b> {escape(rejected_by)}<br>"
        f"<b>Rejected On:</b> {rejected_date}<br>"
        f"<b>Reason:</b> {escape(reason)}<br><br>"
        "Thanks,<br>"
        "Performance Management System"
    )
    plain_text_body = (
        f"Hi {to_name},\n\n"
        f"Your {form_name} for {employee_name} was rejected and needs revision.\n\n"
        "You can revise and resubmit it in the Performance Management System.\n\n"
        "Review Details\n\n"
        f"Employee: {employee_name}\n"
        f"Review Period: {review_period}\n"
        f"Form: {form_name}\n"
        f"Rejected By: {rejected_by}\n"
        f"Rejected On: {rejected_date}\n"
        f"Reason: {reason}\n\n"
        "Thanks,\n"
        "Performance Management System"
    )
    _send(to_email, subject, html_body, plain_text_body)


def send_overall_review_complete_email(
    *,
    to_email: str,
    to_name: str,
    review_period: str,
    approved_by: str,
) -> None:
    # Deliberately different wording from send_review_submitted_email above —
    # the employee isn't reviewing/approving anything here, their review is
    # simply finished, so "action required"/"ready for your review" doesn't
    # apply the way it does for the other three notifications.
    approved_date = datetime.now().strftime("%B %d, %Y")
    subject = f"Your Performance Review is Complete – {to_name}"
    html_body = (
        f"Hi {escape(to_name)},<br><br>"
        f"Your performance review for <b>{escape(review_period)}</b> has been finalized and approved.<br><br>"
        "You can view your completed review in the Performance Management System.<br><br>"
        "<b>Review Details</b><br><br>"
        f"<b>Review Period:</b> {escape(review_period)}<br>"
        f"<b>Approved By:</b> {escape(approved_by)}<br>"
        f"<b>Approved On:</b> {approved_date}<br><br>"
        "Thanks,<br>"
        "Performance Management System"
    )
    plain_text_body = (
        f"Hi {to_name},\n\n"
        f"Your performance review for {review_period} has been finalized and approved.\n\n"
        "You can view your completed review in the Performance Management System.\n\n"
        "Review Details\n\n"
        f"Review Period: {review_period}\n"
        f"Approved By: {approved_by}\n"
        f"Approved On: {approved_date}\n\n"
        "Thanks,\n"
        "Performance Management System"
    )
    _send(to_email, subject, html_body, plain_text_body)
