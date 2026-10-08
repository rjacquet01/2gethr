import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)
const testEmail = 'ray.jacquet@yahoo.com'
const fromEmail = process.env.EMAIL_FROM || 'Togethr <admin@mytogethr.com>'

async function sendTestEmails() {
  console.log('Sending test emails to:', testEmail)
  
  // 1. Send Welcome Email
  console.log('\n1. Sending Welcome Email...')
  try {
    const welcomeResult = await resend.emails.send({
      from: fromEmail,
      to: testEmail,
      subject: 'Welcome to Togethr!',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
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
                Thank you for joining Togethr! We're excited to help you keep your family connected and safe.
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
                Get started by setting up your family profile and inviting your family members. You have a <strong>30-day free Premium trial</strong> to explore all features!
              </p>
              <div style="text-align: center;">
                <a href="https://togethr.app/dashboard" 
                   style="display: inline-block; background-color: #3b4563; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
                  Get Started
                </a>
              </div>
            </div>
            <p style="color: #6b7280; font-size: 12px; text-align: center; margin-top: 20px;">
              Togethr - Keeping Families Connected
            </p>
          </div>
        </body>
        </html>
      `,
      text: 'Welcome to Togethr, Ray! Thank you for joining. Get started by setting up your family profile. You have a 30-day free Premium trial!'
    })
    console.log('Welcome email sent successfully:', welcomeResult)
  } catch (error) {
    console.error('Failed to send welcome email:', error)
  }

  // 2. Send Family Invitation Email
  console.log('\n2. Sending Family Invitation Email...')
  try {
    const inviteResult = await resend.emails.send({
      from: fromEmail,
      to: testEmail,
      subject: 'Sarah invited you to join Jacquet Family on Togethr',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; background-color: #f4f4f5;">
          <div style="max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="background-color: #ffffff; border-radius: 12px; padding: 40px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
              <div style="text-align: center; margin-bottom: 30px;">
                <div style="width: 60px; height: 60px; background-color: #3b4563; border-radius: 12px; display: inline-flex; align-items: center; justify-content: center;">
                  <span style="color: white; font-size: 24px; font-weight: bold;">T</span>
                </div>
              </div>
              <h1 style="color: #3b4563; font-size: 24px; margin: 0 0 20px; text-align: center;">You're Invited!</h1>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                Hi there,
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
                <strong>Sarah</strong> has invited you to join the <strong>Jacquet Family</strong> on Togethr - the app that helps families stay connected and organized.
              </p>
              <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
                With Togethr, you can share calendars, assign tasks, track locations, and keep everyone in sync.
              </p>
              <div style="text-align: center; margin-bottom: 20px;">
                <a href="https://togethr.app/invite/abc123" 
                   style="display: inline-block; background-color: #e97319; color: white; text-decoration: none; padding: 14px 35px; border-radius: 8px; font-weight: 600; font-size: 16px;">
                  Accept Invitation
                </a>
              </div>
              <p style="color: #6b7280; font-size: 14px; line-height: 1.6; margin: 0; text-align: center;">
                This invitation expires in 7 days.
              </p>
            </div>
            <p style="color: #6b7280; font-size: 12px; text-align: center; margin-top: 20px;">
              Togethr - Keeping Families Connected
            </p>
          </div>
        </body>
        </html>
      `,
      text: 'Sarah has invited you to join Jacquet Family on Togethr! Accept the invitation at https://togethr.app/invite/abc123. This invitation expires in 7 days.'
    })
    console.log('Family invitation email sent successfully:', inviteResult)
  } catch (error) {
    console.error('Failed to send family invitation email:', error)
  }

  console.log('\n--- All test emails processed ---')
}

sendTestEmails()
