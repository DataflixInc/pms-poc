"""One-off manual test: sends a real notification email via SendGrid to
verify the configured API key/sender actually work end-to-end.

Usage: python test_email_send.py
"""

from dotenv import load_dotenv

load_dotenv()

import email_service

email_service.send_review_submitted_email(
    to_email="naralasruthi03@gmail.com",
    to_name="Test Recipient",
    employee_name="Test Employee",
    review_period="July 2026 - December 2026",
    template_id=1001,
    submitted_by="Test Employee",
)
print("send attempted — check the inbox and check for any error above")
