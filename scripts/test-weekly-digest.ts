import { Resend } from 'resend'

const resend = new Resend(process.env.RESEND_API_KEY)

async function sendWeeklyDigestTest() {
  const to = 'ray.jacquet@yahoo.com'
  const from = process.env.EMAIL_FROM || 'Togethr <admin@mytogethr.com>'

  // Sample data for test
  const userName = 'Ray'
  const familyName = 'The Jacquet Family'
  const weekStart = new Date()
  const weekEnd = new Date()
  weekEnd.setDate(weekEnd.getDate() + 7)
  
  const weekStartFormatted = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const weekEndFormatted = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  const events = [
    { title: 'Soccer Practice', start_time: new Date(Date.now() + 86400000).toISOString(), location: 'City Park Field' },
    { title: 'Dentist Appointment', start_time: new Date(Date.now() + 172800000).toISOString(), location: 'Dr. Smith\'s Office' },
    { title: 'Family Dinner', start_time: new Date(Date.now() + 259200000).toISOString(), location: 'Grandma\'s House' },
  ]

  const tasks = { completed: 12, pending: 5, overdue: 2 }

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
          <h1 style="color: #3b4563; font-size: 24px; margin: 0 0 10px; text-align: center;">Weekly Summary</h1>
          <p style="color: #6b7280; font-size: 14px; margin: 0 0 30px; text-align: center;">${familyName} - ${weekStartFormatted} to ${weekEndFormatted}</p>
          
          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 20px;">
            Hi ${userName},
          </p>
          <p style="color: #374151; font-size: 16px; line-height: 1.6; margin: 0 0 30px;">
            Here's your weekly family update from Togethr.
          </p>

          <!-- Tasks Summary -->
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 25px;">
            <h2 style="color: #374151; font-size: 18px; margin: 0 0 15px;">Tasks This Week</h2>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="text-align: center; padding: 10px;">
                  <div style="font-size: 28px; font-weight: bold; color: #10b981;">${tasks.completed}</div>
                  <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Completed</div>
                </td>
                <td style="text-align: center; padding: 10px;">
                  <div style="font-size: 28px; font-weight: bold; color: #f59e0b;">${tasks.pending}</div>
                  <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Pending</div>
                </td>
                <td style="text-align: center; padding: 10px;">
                  <div style="font-size: 28px; font-weight: bold; color: #ef4444;">${tasks.overdue}</div>
                  <div style="font-size: 12px; color: #6b7280; text-transform: uppercase;">Overdue</div>
                </td>
              </tr>
            </table>
          </div>

          <!-- Upcoming Events -->
          <div style="margin-bottom: 30px;">
            <h2 style="color: #374151; font-size: 18px; margin: 0 0 15px;">Upcoming Events (${events.length})</h2>
            ${events.map(event => `
              <div style="border-left: 3px solid #3b4563; padding-left: 15px; margin-bottom: 15px;">
                <div style="font-weight: 600; color: #374151;">${event.title}</div>
                <div style="font-size: 14px; color: #6b7280;">${new Date(event.start_time).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
                ${event.location ? `<div style="font-size: 14px; color: #6b7280;">${event.location}</div>` : ''}
              </div>
            `).join('')}
          </div>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://togethr.app/dashboard" 
               style="display: inline-block; background-color: #3b4563; color: white; text-decoration: none; padding: 12px 30px; border-radius: 8px; font-weight: 600;">
              View Full Dashboard
            </a>
          </div>

          <p style="color: #9ca3af; font-size: 12px; line-height: 1.6; margin: 30px 0 0; text-align: center;">
            You're receiving this because you have weekly digest enabled.<br>
            <a href="https://togethr.app/settings" style="color: #6b7280;">Manage notification preferences</a>
          </p>
        </div>
      </div>
    </body>
    </html>
  `

  console.log('Sending weekly digest test email...')
  console.log('To:', to)
  console.log('From:', from)

  try {
    const result = await resend.emails.send({
      from,
      to,
      subject: `Weekly Family Summary - ${familyName}`,
      html,
      text: `Weekly Summary for ${familyName} (${weekStartFormatted} - ${weekEndFormatted})\n\nHi ${userName},\n\nTasks: ${tasks.completed} completed, ${tasks.pending} pending, ${tasks.overdue} overdue\n\nUpcoming Events: ${events.length}\n${events.map(e => `- ${e.title} (${new Date(e.start_time).toLocaleDateString()})`).join('\n')}\n\nView dashboard: https://togethr.app/dashboard`,
    })

    console.log('Weekly digest email sent successfully!')
    console.log('Email ID:', result.data?.id)
  } catch (error) {
    console.error('Failed to send weekly digest email:', error)
    throw error
  }
}

sendWeeklyDigestTest()
