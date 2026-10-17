# Safe Link - Consumer App User Manual

## Table of Contents
1. [Getting Started](#getting-started)
2. [Account Management](#account-management)
3. [Family Setup](#family-setup)
4. [Calendar & Events](#calendar--events)
5. [Location Features](#location-features)
6. [Notifications](#notifications)
7. [Subscription & Premium Features](#subscription--premium-features)
8. [Troubleshooting](#troubleshooting)

---

## Getting Started

### What is Safe Link?
Safe Link is a family coordination app that helps busy families stay connected through shared calendars, location sharing, and event management. Parents can coordinate schedules, track children's locations (with consent), and manage family activities all in one place.

### System Requirements
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Internet connection
- Valid email address for registration

### Demo Account (For Testing)
```
Email: parent@demo.safelink.app
Password: Demo123!
```

---

## Account Management

### Creating an Account

1. Navigate to the Safe Link homepage
2. Click **"Get Started"** or **"Sign Up"**
3. Fill in the registration form:
   - **First Name**: Your first name
   - **Last Name**: Your last name
   - **Email**: Valid email address (will be your login)
   - **Password**: Minimum 8 characters with uppercase, lowercase, and number
   - **Phone** (optional): For SMS notifications
4. Click **"Create Account"**
5. You'll be redirected to the onboarding flow

### Logging In

1. Go to `/login`
2. Enter your email and password
3. Click **"Sign In"**
4. You'll be redirected to your dashboard

### Updating Your Profile

1. Click your profile avatar in the top-right corner
2. Select **"Profile"** from the dropdown
3. You can update:
   - Profile photo (upload JPG/PNG, max 5MB)
   - First and last name
   - Phone number
   - Notification preferences
4. Click **"Save Changes"**

### Changing Your Password

1. Go to Profile settings
2. Scroll to **"Security"** section
3. Enter your current password
4. Enter and confirm your new password
5. Click **"Update Password"**

---

## Family Setup

### Creating a New Family

1. After registration, you'll see the onboarding screen
2. Select **"Create a New Family"**
3. Enter your family name (e.g., "The Johnsons")
4. Click **"Create Family"**
5. You'll be set as the **PARENT** (owner) role

### Joining an Existing Family

1. On the onboarding screen, select **"Join Existing Family"**
2. Enter the **Invite Code** provided by the family owner
3. Click **"Join Family"**
4. Wait for the family owner to approve your membership (if required)

### Inviting Family Members

**As a Parent:**
1. Go to **Family** page from the sidebar
2. Click **"Invite Member"**
3. Choose the role for the new member:
   - **PARENT**: Full access to all family features
   - **GUARDIAN**: Limited access (e.g., babysitter, grandparent)
   - **CHILD**: Restricted access with parental controls
4. Copy the generated **Invite Code**
5. Share the code with the person you're inviting
6. The code expires in 7 days

### Managing Family Members

**Viewing Members:**
- Go to **Family** page to see all current members
- Each member card shows their role, status, and join date

**Updating Member Roles:**
1. Click on a member's card
2. Click **"Edit Role"**
3. Select the new role
4. Click **"Save"**

**Removing Members:**
1. Click on a member's card
2. Click **"Remove from Family"**
3. Confirm the action

### Adding Children

Children in Safe Link are special accounts that can be:
- Linked to an existing user account (for older children with their own devices)
- Created as managed profiles (for younger children without accounts)

**To add a child:**
1. Go to **Family** page
2. Click **"Add Child"**
3. Fill in child details:
   - Name
   - Birth date
   - Whether they can create events
   - Whether events require approval
4. Click **"Add Child"**

---

## Calendar & Events

### Viewing the Calendar

1. Click **"Calendar"** in the sidebar
2. Use the toggle to switch between:
   - **Month View**: See the full month at a glance
   - **Week View**: Detailed weekly schedule
3. Click on any day to see events for that day
4. Events are color-coded by category:
   - Blue: School
   - Green: Sports
   - Purple: Medical
   - Orange: Social
   - Gray: Other

### Creating Events

1. On the Calendar page, click **"New Event"**
2. Fill in event details:
   - **Title**: Name of the event
   - **Description** (optional): Additional details
   - **Date & Time**: When the event occurs
   - **End Time**: When the event ends
   - **Category**: School, Sports, Medical, Social, or Other
   - **Location**: Where the event takes place
   - **Participants**: Family members involved
   - **Visibility**: Who can see this event
3. Click **"Create Event"**

### Event Visibility Options

- **FAMILY**: All family members can see the event
- **PARENTS_ONLY**: Only parents and guardians can see
- **PARTICIPANT_ONLY**: Only assigned participants can see
- **PRIVATE**: Only you can see

### Recurring Events

1. When creating an event, toggle **"Recurring Event"**
2. Select the recurrence pattern:
   - **Daily**: Every day or every X days
   - **Weekly**: Same day(s) each week
   - **Monthly**: Same date each month or same weekday
   - **Yearly**: Same date each year
3. Set the end condition:
   - Never (ongoing)
   - After X occurrences
   - On a specific date

### Event Approval Workflow (For Children)

If a child creates an event and requires approval:

1. The event appears as **"Pending"** on the calendar
2. Parents receive a notification
3. Parents can view pending events on the Dashboard under **"Pending Approvals"**
4. Click **"Approve"** or **"Reject"**
5. The child receives a notification of the decision

### Editing Events

1. Click on an event in the calendar
2. Click **"Edit"**
3. Make your changes
4. For recurring events, choose:
   - Edit this occurrence only
   - Edit all future occurrences
   - Edit all occurrences
5. Click **"Save Changes"**

### Deleting Events

1. Click on an event
2. Click **"Delete"**
3. For recurring events, choose which occurrences to delete
4. Confirm deletion

---

## Location Features

### Overview

Location features allow parents to:
- See children's current location (when sharing is enabled)
- Get alerts when children arrive at or leave specific places
- Define safe zones (geofences) for automatic notifications

**Privacy First:** Location sharing is always opt-in and controlled by parents. Children's location is never shared without explicit permission.

### Enabling Location Sharing

**For a child's device:**
1. Go to **Family** page
2. Click on the child's profile
3. Toggle **"Location Sharing"** to ON
4. Choose sharing mode:
   - **ACTIVE**: Real-time location updates
   - **CHECK_IN**: Location shared only on check-in
   - **OFF**: No location sharing

### Saved Places

Create named locations for easy reference and geofencing:

1. Go to **Places** (in sidebar or settings)
2. Click **"Add Place"**
3. Enter:
   - Name (e.g., "School", "Home", "Soccer Field")
   - Address
   - Category: Home, School, Work, Medical, Sports, Other
4. Optionally enable **Geofence Alerts**
5. Click **"Save Place"**

### Geofence Alerts

Get notified when family members arrive at or leave specific locations:

1. Edit a Saved Place
2. Toggle **"Enable Geofence"**
3. Set the radius (default: 100 meters)
4. Choose alert types:
   - Arrival alerts
   - Departure alerts
5. Select which family members trigger alerts
6. Click **"Save"**

### Viewing Location History

1. Go to the child's profile
2. Click **"Location History"**
3. View past locations and timestamps
4. Filter by date range

---

## Notifications

### Notification Types

- **Event Reminders**: Upcoming event alerts
- **Event Updates**: Changes to events you're part of
- **Approval Requests**: Child event requests needing approval
- **Location Alerts**: Geofence arrival/departure notifications
- **Family Updates**: New members, role changes
- **Subscription Alerts**: Billing and plan updates

### Managing Notifications

1. Go to your Profile settings
2. Click **"Notification Preferences"**
3. Toggle each notification type on/off
4. Set reminder timing (e.g., 15 min, 1 hour, 1 day before)

### Viewing Notifications

1. Click the bell icon in the header
2. See all unread notifications
3. Click a notification to view details
4. Click **"Mark All Read"** to clear

---

## Subscription & Premium Features

### Free vs Premium

| Feature | Free | Premium |
|---------|------|---------|
| Family members | Up to 4 | Unlimited |
| Children profiles | Up to 2 | Up to 10 |
| Calendars | 1 | Multiple |
| Event history | 30 days | Unlimited |
| Location sharing | Basic | Real-time |
| Geofences | 2 | Unlimited |
| Export data | No | Yes |

### Upgrading to Premium

1. Go to **Settings** > **Subscription**
2. Click **"Upgrade to Premium"**
3. Select billing period:
   - Monthly: $9.99/month
   - Annual: $99.99/year (save 17%)
4. Complete payment through Google Play / App Store
5. Premium features activate immediately

### Managing Your Subscription

1. Go to **Settings** > **Subscription**
2. View current plan and billing date
3. Options available:
   - Change plan
   - Update payment method
   - Cancel subscription

### Starting a Free Trial

New users can start a 7-day Premium trial (length set by TRIAL_DAYS in lib/subscription-tiers.ts):
1. Go to **Settings** > **Subscription**
2. Click **"Start Free Trial"**
3. No payment required during trial
4. Cancel anytime before trial ends

---

## Troubleshooting

### Can't Log In

1. Verify you're using the correct email
2. Try resetting your password via **"Forgot Password"**
3. Check for caps lock
4. Clear browser cache and cookies

### Events Not Showing

1. Check the calendar date range
2. Verify event visibility settings
3. Ensure you're a participant or have appropriate permissions
4. Pull down to refresh (mobile) or reload page (web)

### Location Not Updating

1. Verify location sharing is enabled
2. Check device location permissions
3. Ensure good internet connection
4. Check that location mode is set to ACTIVE

### Invite Code Not Working

1. Codes expire after 7 days - request a new one
2. Codes are case-sensitive
3. Verify the family still has available member slots

### Notifications Not Appearing

1. Check notification permissions in device settings
2. Verify notification preferences in the app
3. Ensure you're not in Do Not Disturb mode

### Need More Help?

Contact our support team:
- Email: support@safelink.app
- In-app: Settings > Help & Support > Contact Us

---

## Keyboard Shortcuts (Web)

| Action | Shortcut |
|--------|----------|
| New Event | `N` |
| Today | `T` |
| Month View | `M` |
| Week View | `W` |
| Next Period | `→` |
| Previous Period | `←` |
| Search | `Ctrl/Cmd + K` |
| Settings | `Ctrl/Cmd + ,` |

---

*Last Updated: March 2026*
*Version: 1.0.0*
