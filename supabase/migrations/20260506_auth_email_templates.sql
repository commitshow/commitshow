-- Seed email_templates rows for the 5 Supabase Auth email kinds.
-- Consumed by the auth-email-hook Edge Function: when Supabase Auth
-- needs to send a confirmation / magic-link / recovery / invite /
-- email-change message, it POSTs to our Hook endpoint with the
-- email_action_type — we look up the matching `auth_*` template,
-- substitute {{confirmation_url}} + {{display_name}}, and send via
-- Resend through the same path the rest of our transactional mail
-- uses.
--
-- Variables available to every template (Supabase Auth Hook payload):
--   confirmation_url · the auth.v1/verify link the user clicks
--   display_name     · best-effort from members.display_name (may be
--                       NULL pre-trigger; falls back to email local part)
--   email            · the recipient address
--   site_url         · base URL of commit.show
--   token            · 6-digit OTP (when applicable)
--
-- HTML bodies are minimal but on-brand · navy bg · gold + cream text.
-- Admins can edit at /admin/emails after seed.

INSERT INTO email_templates (kind, subject, html_body, text_body, variables, description) VALUES
(
  'auth_signup_confirmation',
  'Confirm your commit.show signup',
  E'<!doctype html>
<html><body style="margin:0;padding:0;background:#060C1A;font-family:DM Sans,system-ui,sans-serif;color:#F8F5EE;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060C1A;">
    <tr><td align="center" style="padding:48px 24px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0F2040;border:1px solid rgba(240,192,64,0.25);border-radius:2px;">
        <tr><td style="padding:40px 40px 32px;">
          <div style="font-family:Playfair Display,Georgia,serif;font-size:28px;color:#F0C040;letter-spacing:-0.5px;">commit.show</div>
          <div style="font-size:11px;color:rgba(248,245,238,0.5);letter-spacing:3px;text-transform:uppercase;margin-top:4px;">audit · audition · encore</div>

          <h1 style="font-family:Playfair Display,Georgia,serif;font-size:36px;color:#F8F5EE;margin:32px 0 16px;letter-spacing:-1px;">Confirm your signup</h1>
          <p style="font-size:16px;line-height:1.6;color:rgba(248,245,238,0.85);margin:0 0 24px;">Hi {{display_name}}, click the button below to activate your commit.show account. Audit · audition · encore — every commit, on stage.</p>

          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:2px;background:#F0C040;">
            <a href="{{confirmation_url}}" style="display:inline-block;padding:14px 28px;font-family:DM Sans,system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:1px;color:#060C1A;text-decoration:none;text-transform:uppercase;">Confirm email</a>
          </td></tr></table>

          <p style="font-size:13px;line-height:1.6;color:rgba(248,245,238,0.5);margin:24px 0 0;">Or copy this link: <br><a href="{{confirmation_url}}" style="color:rgba(248,245,238,0.7);word-break:break-all;">{{confirmation_url}}</a></p>
          <p style="font-size:12px;color:rgba(248,245,238,0.4);margin:32px 0 0;">If you didn''t sign up for commit.show, you can ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>',
  E'commit.show — confirm your signup\n\nHi {{display_name}},\n\nClick this link to activate your account:\n{{confirmation_url}}\n\nIf you didn''t sign up, ignore this email.',
  ARRAY['confirmation_url','display_name','email'],
  'Sent when a new user signs up via email + password. Supabase Auth requires the user to click the link before they can sign in.'
),
(
  'auth_magic_link',
  'Sign in to commit.show',
  E'<!doctype html>
<html><body style="margin:0;padding:0;background:#060C1A;font-family:DM Sans,system-ui,sans-serif;color:#F8F5EE;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060C1A;">
    <tr><td align="center" style="padding:48px 24px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0F2040;border:1px solid rgba(240,192,64,0.25);border-radius:2px;">
        <tr><td style="padding:40px 40px 32px;">
          <div style="font-family:Playfair Display,Georgia,serif;font-size:28px;color:#F0C040;letter-spacing:-0.5px;">commit.show</div>
          <div style="font-size:11px;color:rgba(248,245,238,0.5);letter-spacing:3px;text-transform:uppercase;margin-top:4px;">audit · audition · encore</div>

          <h1 style="font-family:Playfair Display,Georgia,serif;font-size:36px;color:#F8F5EE;margin:32px 0 16px;letter-spacing:-1px;">Your magic link</h1>
          <p style="font-size:16px;line-height:1.6;color:rgba(248,245,238,0.85);margin:0 0 24px;">Hi {{display_name}}, click below to sign in. Single-use · expires in an hour.</p>

          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:2px;background:#F0C040;">
            <a href="{{confirmation_url}}" style="display:inline-block;padding:14px 28px;font-family:DM Sans,system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:1px;color:#060C1A;text-decoration:none;text-transform:uppercase;">Sign in</a>
          </td></tr></table>

          <p style="font-size:13px;line-height:1.6;color:rgba(248,245,238,0.5);margin:24px 0 0;">Or copy this link: <br><a href="{{confirmation_url}}" style="color:rgba(248,245,238,0.7);word-break:break-all;">{{confirmation_url}}</a></p>
          <p style="font-size:12px;color:rgba(248,245,238,0.4);margin:32px 0 0;">If you didn''t request this, you can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>',
  E'commit.show — your magic link\n\n{{confirmation_url}}\n\nSingle-use · expires in an hour.',
  ARRAY['confirmation_url','display_name','email'],
  'Magic-link sign-in email · sent when a user requests passwordless sign in.'
),
(
  'auth_recovery',
  'Reset your commit.show password',
  E'<!doctype html>
<html><body style="margin:0;padding:0;background:#060C1A;font-family:DM Sans,system-ui,sans-serif;color:#F8F5EE;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060C1A;">
    <tr><td align="center" style="padding:48px 24px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0F2040;border:1px solid rgba(240,192,64,0.25);border-radius:2px;">
        <tr><td style="padding:40px 40px 32px;">
          <div style="font-family:Playfair Display,Georgia,serif;font-size:28px;color:#F0C040;letter-spacing:-0.5px;">commit.show</div>
          <div style="font-size:11px;color:rgba(248,245,238,0.5);letter-spacing:3px;text-transform:uppercase;margin-top:4px;">audit · audition · encore</div>

          <h1 style="font-family:Playfair Display,Georgia,serif;font-size:36px;color:#F8F5EE;margin:32px 0 16px;letter-spacing:-1px;">Reset your password</h1>
          <p style="font-size:16px;line-height:1.6;color:rgba(248,245,238,0.85);margin:0 0 24px;">Hi {{display_name}}, click below to set a new password. The link is single-use and expires in an hour.</p>

          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:2px;background:#F0C040;">
            <a href="{{confirmation_url}}" style="display:inline-block;padding:14px 28px;font-family:DM Sans,system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:1px;color:#060C1A;text-decoration:none;text-transform:uppercase;">Reset password</a>
          </td></tr></table>

          <p style="font-size:13px;line-height:1.6;color:rgba(248,245,238,0.5);margin:24px 0 0;">Or copy this link: <br><a href="{{confirmation_url}}" style="color:rgba(248,245,238,0.7);word-break:break-all;">{{confirmation_url}}</a></p>
          <p style="font-size:12px;color:rgba(248,245,238,0.4);margin:32px 0 0;">If you didn''t request a password reset, you can safely ignore this email — your account stays as-is.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>',
  E'commit.show — reset your password\n\n{{confirmation_url}}\n\nSingle-use · expires in an hour.',
  ARRAY['confirmation_url','display_name','email'],
  'Password reset email · sent when a user requests recovery via the sign-in screen.'
),
(
  'auth_invite',
  'You''ve been invited to commit.show',
  E'<!doctype html>
<html><body style="margin:0;padding:0;background:#060C1A;font-family:DM Sans,system-ui,sans-serif;color:#F8F5EE;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060C1A;">
    <tr><td align="center" style="padding:48px 24px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0F2040;border:1px solid rgba(240,192,64,0.25);border-radius:2px;">
        <tr><td style="padding:40px 40px 32px;">
          <div style="font-family:Playfair Display,Georgia,serif;font-size:28px;color:#F0C040;letter-spacing:-0.5px;">commit.show</div>
          <div style="font-size:11px;color:rgba(248,245,238,0.5);letter-spacing:3px;text-transform:uppercase;margin-top:4px;">audit · audition · encore</div>

          <h1 style="font-family:Playfair Display,Georgia,serif;font-size:36px;color:#F8F5EE;margin:32px 0 16px;letter-spacing:-1px;">You''re invited</h1>
          <p style="font-size:16px;line-height:1.6;color:rgba(248,245,238,0.85);margin:0 0 24px;">You''ve been invited to commit.show — the audit ladder for vibe coding. Click below to accept and set up your account.</p>

          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:2px;background:#F0C040;">
            <a href="{{confirmation_url}}" style="display:inline-block;padding:14px 28px;font-family:DM Sans,system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:1px;color:#060C1A;text-decoration:none;text-transform:uppercase;">Accept invite</a>
          </td></tr></table>

          <p style="font-size:13px;line-height:1.6;color:rgba(248,245,238,0.5);margin:24px 0 0;">Or copy this link: <br><a href="{{confirmation_url}}" style="color:rgba(248,245,238,0.7);word-break:break-all;">{{confirmation_url}}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>',
  E'You''ve been invited to commit.show.\n\n{{confirmation_url}}',
  ARRAY['confirmation_url','email'],
  'Invite email · sent when an admin invites a user via Supabase Auth.'
),
(
  'auth_email_change',
  'Confirm your new commit.show email',
  E'<!doctype html>
<html><body style="margin:0;padding:0;background:#060C1A;font-family:DM Sans,system-ui,sans-serif;color:#F8F5EE;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#060C1A;">
    <tr><td align="center" style="padding:48px 24px;">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0F2040;border:1px solid rgba(240,192,64,0.25);border-radius:2px;">
        <tr><td style="padding:40px 40px 32px;">
          <div style="font-family:Playfair Display,Georgia,serif;font-size:28px;color:#F0C040;letter-spacing:-0.5px;">commit.show</div>
          <div style="font-size:11px;color:rgba(248,245,238,0.5);letter-spacing:3px;text-transform:uppercase;margin-top:4px;">audit · audition · encore</div>

          <h1 style="font-family:Playfair Display,Georgia,serif;font-size:36px;color:#F8F5EE;margin:32px 0 16px;letter-spacing:-1px;">Confirm new email</h1>
          <p style="font-size:16px;line-height:1.6;color:rgba(248,245,238,0.85);margin:0 0 24px;">Click below to confirm this is your new email for commit.show.</p>

          <table cellpadding="0" cellspacing="0"><tr><td style="border-radius:2px;background:#F0C040;">
            <a href="{{confirmation_url}}" style="display:inline-block;padding:14px 28px;font-family:DM Sans,system-ui,sans-serif;font-size:14px;font-weight:600;letter-spacing:1px;color:#060C1A;text-decoration:none;text-transform:uppercase;">Confirm email</a>
          </td></tr></table>

          <p style="font-size:13px;line-height:1.6;color:rgba(248,245,238,0.5);margin:24px 0 0;">Or copy this link: <br><a href="{{confirmation_url}}" style="color:rgba(248,245,238,0.7);word-break:break-all;">{{confirmation_url}}</a></p>
          <p style="font-size:12px;color:rgba(248,245,238,0.4);margin:32px 0 0;">If you didn''t request this change, contact support — your account email may be at risk.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>',
  E'commit.show — confirm new email\n\n{{confirmation_url}}',
  ARRAY['confirmation_url','email'],
  'Email-change confirmation · sent to the new address when a user changes their account email.'
)
ON CONFLICT (kind) DO NOTHING;
