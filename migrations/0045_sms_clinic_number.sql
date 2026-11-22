-- Texts and emails give the clinic's main mobile, 0968 661 0021, instead of 0916 415 8426 (owners' request). Changes
-- the wording in use and the "Reset to Default" wording; nothing else in the templates is touched.
UPDATE message_templates SET
  sms_text = replace(sms_text, '0916 415 8426', '0968 661 0021'),
  email_subject = replace(email_subject, '0916 415 8426', '0968 661 0021'),
  email_intro = replace(email_intro, '0916 415 8426', '0968 661 0021'),
  default_sms_text = replace(default_sms_text, '0916 415 8426', '0968 661 0021'),
  default_email_subject = replace(default_email_subject, '0916 415 8426', '0968 661 0021'),
  default_email_intro = replace(default_email_intro, '0916 415 8426', '0968 661 0021');
