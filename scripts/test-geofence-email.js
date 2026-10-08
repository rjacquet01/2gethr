const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);

async function sendGeofenceAlertEmail() {
  const childName = 'Emma';
  const placeName = 'Lincoln Elementary School';
  const eventType = 'arrived at';
  const timestamp = new Date().toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });

  const html = `
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
          
          <div style="text-align: center; margin-bottom: 25px;">
            <div style="display: inline-block; background-color: #10b981; color: white; padding: 8px 16px; border-radius: 20px; font-size: 14px; font-weight: 600;">
              ARRIVAL ALERT
            </div>
          </div>
          
          <h1 style="color: #3b4563; font-size: 24px; margin: 0 0 20px; text-align: center;">
            ${childName} has ${eventType} ${placeName}
          </h1>
          
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Child</td>
                <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 600; text-align: right;">${childName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Location</td>
                <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 600; text-align: right;">${placeName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Event</td>
                <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 600; text-align: right;">Arrived</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Time</td>
                <td style="padding: 8px 0; color: #374151; font-size: 14px; font-weight: 600; text-align: right;">${timestamp}</td>
              </tr>
            </table>
          </div>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="https://togethr.vercel.app/location" 
               style="display: inline-block; background-color: #3b4563; color: white; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-weight: 600; font-size: 16px;">
              View Location
            </a>
          </div>
          
          <p style="color: #9ca3af; font-size: 12px; line-height: 1.6; margin: 30px 0 0; text-align: center;">
            You're receiving this because you have geofence alerts enabled for ${childName}.<br>
            <a href="https://togethr.vercel.app/settings" style="color: #6b7280;">Manage notification preferences</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `;

  console.log('='.repeat(60));
  console.log('GEOFENCE NOTIFICATION TEST');
  console.log('='.repeat(60));
  console.log('');
  console.log('Simulating: Emma arrived at Lincoln Elementary School');
  console.log('Sending notification to: ray.jacquet@yahoo.com');
  console.log('');

  try {
    // Send arrival notification
    const arrivalResult = await resend.emails.send({
      from: 'Togethr <admin@mytogethr.com>',
      to: 'ray.jacquet@yahoo.com',
      subject: `📍 ${childName} arrived at ${placeName}`,
      html: html,
      text: `${childName} has arrived at ${placeName} at ${timestamp}. View location: https://togethr.vercel.app/location`
    });

    console.log('✓ ARRIVAL notification sent!');
    console.log('  Email ID:', arrivalResult.data?.id);
    console.log('');

    // Wait 2 seconds then send departure notification
    await new Promise(resolve => setTimeout(resolve, 2000));

    const departureHtml = html
      .replace('ARRIVAL ALERT', 'DEPARTURE ALERT')
      .replace('#10b981', '#f59e0b')
      .replace('arrived at', 'left')
      .replace('Arrived', 'Departed');

    const departureResult = await resend.emails.send({
      from: 'Togethr <admin@mytogethr.com>',
      to: 'ray.jacquet@yahoo.com',
      subject: `📍 ${childName} left ${placeName}`,
      html: departureHtml,
      text: `${childName} has left ${placeName} at ${timestamp}. View location: https://togethr.vercel.app/location`
    });

    console.log('✓ DEPARTURE notification sent!');
    console.log('  Email ID:', departureResult.data?.id);
    console.log('');
    console.log('='.repeat(60));
    console.log('TEST COMPLETE - Check ray.jacquet@yahoo.com for 2 emails');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('Error sending geofence notification:', error);
  }
}

sendGeofenceAlertEmail();
