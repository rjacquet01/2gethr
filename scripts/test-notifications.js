const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const EMAIL_FROM = 'Togethr <admin@mytogethr.com>';
const TEST_EMAIL = 'ray.jacquet@yahoo.com';
// Use environment variable or fallback - update NEXT_PUBLIC_APP_URL after publishing
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://togethr-app.vercel.app';

async function sendTestNotifications() {
  console.log('=== TOGETHR NOTIFICATION TEST ===\n');
  console.log(`Sending to: ${TEST_EMAIL}`);
  console.log(`From: ${EMAIL_FROM}\n`);

  const results = [];

  // 1. Welcome Email
  console.log('1. Sending Welcome Email...');
  try {
    const welcome = await resend.emails.send({
      from: EMAIL_FROM,
      to: TEST_EMAIL,
      subject: 'Welcome to Togethr!',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 30px;">
                <div style="width: 60px; height: 60px; background-color: #3b4563; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
                  <span style="color: white; font-size: 24px; font-weight: bold;">T</span>
                </div>
              </div>
              <h1 style="color: #3b4563; font-size: 24px; margin: 0 0 20px; text-align: center;">Welcome to Togethr!</h1>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                Hi Ray,
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                Thank you for joining Togethr! We're excited to help you keep your family connected and organized.
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
                With Togethr, you can:
              </p>
              <ul style="color: #374151; font-size: 16px; line-height: 1.8; margin: 0 0 30px; padding-left: 20px;">
                <li>Share family calendars and events</li>
                <li>Track tasks and chores</li>
                <li>Stay connected with real-time location sharing</li>
                <li>Receive important alerts and reminders</li>
              </ul>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${APP_URL}/dashboard" style="display: inline-block; background-color: #3b4563; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">
                  Get Started
                </a>
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: 'Welcome to Togethr! Thank you for joining. Get started at ${APP_URL}/dashboard'
    });
    console.log('   ✓ Welcome email sent:', welcome.data?.id);
    results.push({ type: 'Welcome', status: 'sent', id: welcome.data?.id });
  } catch (err) {
    console.log('   ✗ Failed:', err.message);
    results.push({ type: 'Welcome', status: 'failed', error: err.message });
  }

  // 2. Task Reminder
  console.log('2. Sending Task Reminder...');
  try {
    const task = await resend.emails.send({
      from: EMAIL_FROM,
      to: TEST_EMAIL,
      subject: 'Task Reminder: Clean bedroom',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="width: 50px; height: 50px; background-color: #f59e0b; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                  <span style="color: white; font-size: 24px;">✓</span>
                </div>
              </div>
              <h1 style="color: #374151; font-size: 22px; margin: 0 0 20px; text-align: center;">Task Reminder</h1>
              <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
                <p style="color: #92400e; font-size: 14px; margin: 0 0 5px; font-weight: 600;">DUE TODAY</p>
                <p style="color: #374151; font-size: 18px; margin: 0; font-weight: 600;">Clean bedroom</p>
              </div>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 20px;">
                <strong>Assigned to:</strong> Emma<br>
                <strong>Due:</strong> Today at 5:00 PM<br>
                <strong>Points:</strong> 10 pts
              </p>
              <div style="text-align: center;">
                <a href="${APP_URL}/tasks" style="display: inline-block; background-color: #3b4563; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600;">
                  View Task
                </a>
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: 'Task Reminder: Clean bedroom is due today at 5:00 PM. Assigned to Emma. View at ${APP_URL}/tasks'
    });
    console.log('   ✓ Task reminder sent:', task.data?.id);
    results.push({ type: 'Task Reminder', status: 'sent', id: task.data?.id });
  } catch (err) {
    console.log('   ✗ Failed:', err.message);
    results.push({ type: 'Task Reminder', status: 'failed', error: err.message });
  }

  // 3. Event Reminder
  console.log('3. Sending Event Reminder...');
  try {
    const event = await resend.emails.send({
      from: EMAIL_FROM,
      to: TEST_EMAIL,
      subject: 'Reminder: Soccer Practice in 1 hour',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 20px;">
                <div style="width: 50px; height: 50px; background-color: #10b981; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;">
                  <span style="color: white; font-size: 24px;">📅</span>
                </div>
              </div>
              <h1 style="color: #374151; font-size: 22px; margin: 0 0 20px; text-align: center;">Event Reminder</h1>
              <div style="background-color: #d1fae5; border-left: 4px solid #10b981; padding: 15px 20px; border-radius: 0 8px 8px 0; margin-bottom: 20px;">
                <p style="color: #065f46; font-size: 14px; margin: 0 0 5px; font-weight: 600;">STARTING IN 1 HOUR</p>
                <p style="color: #374151; font-size: 18px; margin: 0; font-weight: 600;">Soccer Practice</p>
              </div>
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 20px;">
                <strong>When:</strong> Today at 4:00 PM<br>
                <strong>Where:</strong> Riverside Park, Field 3<br>
                <strong>Who:</strong> Emma
              </p>
              <div style="text-align: center;">
                <a href="${APP_URL}/calendar" style="display: inline-block; background-color: #3b4563; color: white; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600;">
                  View Calendar
                </a>
              </div>
            </div>
          </div>
        </body>
        </html>
      `,
      text: 'Event Reminder: Soccer Practice starts in 1 hour at Riverside Park, Field 3. View at ${APP_URL}/calendar'
    });
    console.log('   ✓ Event reminder sent:', event.data?.id);
    results.push({ type: 'Event Reminder', status: 'sent', id: event.data?.id });
  } catch (err) {
    console.log('   ✗ Failed:', err.message);
    results.push({ type: 'Event Reminder', status: 'failed', error: err.message });
  }

  // 4. Family Invitation
  console.log('4. Sending Family Invitation...');
  try {
    const invite = await resend.emails.send({
      from: EMAIL_FROM,
      to: TEST_EMAIL,
      subject: "You're invited to join The Jacquet Family on Togethr",
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 30px;">
                <div style="width: 60px; height: 60px; background-color: #3b4563; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
                  <span style="color: white; font-size: 24px; font-weight: bold;">T</span>
                </div>
              </div>
              <h1 style="color: #3b4563; font-size: 24px; margin: 0 0 20px; text-align: center;">You're Invited!</h1>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px; text-align: center;">
                <strong>Sarah Jacquet</strong> has invited you to join <strong>The Jacquet Family</strong> on Togethr.
              </p>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0 0 30px; text-align: center;">
                Accept this invitation to share calendars, tasks, and stay connected with your family.
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <a href="${APP_URL}/invite/accept?token=test123" style="display: inline-block; background-color: #3b4563; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600;">
                  Accept Invitation
                </a>
              </div>
              <p style="color: #9ca3af; font-size: 12px; text-align: center; margin: 20px 0 0;">
                This invitation expires in 7 days.
              </p>
            </div>
          </div>
        </body>
        </html>
      `,
      text: 'Sarah Jacquet has invited you to join The Jacquet Family on Togethr. Accept at ${APP_URL}/invite/accept?token=test123'
    });
    console.log('   ✓ Family invitation sent:', invite.data?.id);
    results.push({ type: 'Family Invitation', status: 'sent', id: invite.data?.id });
  } catch (err) {
    console.log('   ✗ Failed:', err.message);
    results.push({ type: 'Family Invitation', status: 'failed', error: err.message });
  }

  // Summary
  console.log('\n=== SUMMARY ===');
  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'failed').length;
  console.log(`Sent: ${sent}/${results.length}`);
  console.log(`Failed: ${failed}/${results.length}`);
  
  if (failed > 0) {
    console.log('\nFailed notifications:');
    results.filter(r => r.status === 'failed').forEach(r => {
      console.log(`  - ${r.type}: ${r.error}`);
    });
  }

  console.log('\nCheck inbox at:', TEST_EMAIL);
}

sendTestNotifications().catch(console.error);
