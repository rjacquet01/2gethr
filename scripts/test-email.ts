import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendTestEmail() {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM || 'Togethr <admin@mytogethr.com>',
      to: 'ray.jacquet@yahoo.com',
      subject: 'Togethr Test Email',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #3b4563;">Welcome to Togethr!</h1>
          <p>Congrats on sending your <strong>first test email</strong>!</p>
          <p>Your email service is now configured and working correctly.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="color: #888; font-size: 12px;">This is a test email from Togethr.</p>
        </div>
      `
    });

    if (error) {
      console.error('Error sending email:', error);
      return;
    }

    console.log('Email sent successfully!');
    console.log('Email ID:', data?.id);
  } catch (err) {
    console.error('Failed to send email:', err);
  }
}

sendTestEmail();
