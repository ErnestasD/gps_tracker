import type { KbArticle } from './types.js'

import { howTrackingWorks } from './articles/how-tracking-works.js'
import { firstSteps } from './articles/first-steps.js'
import { loginsAndRoles } from './articles/logins-and-roles.js'
import { glossary } from './articles/glossary.js'
import { chooseATracker } from './articles/choose-a-tracker.js'
import { imei } from './articles/imei.js'
import { simAndApn } from './articles/sim-and-apn.js'
import { connectATracker } from './articles/connect-a-tracker.js'
import { configSms } from './articles/config-sms.js'
import { reportingIntervals } from './articles/reporting-intervals.js'
import { commands } from './articles/commands.js'
import { canAndObd } from './articles/can-and-obd.js'
import { deviceLifecycle } from './articles/device-lifecycle.js'
import { mapBasics } from './articles/map-basics.js'
import { positionAccuracy } from './articles/position-accuracy.js'
import { deviceStatus } from './articles/device-status.js'
import { shareALiveLink } from './articles/share-a-live-link.js'
import { howTripsAreDetected } from './articles/how-trips-are-detected.js'
import { distanceAndOdometer } from './articles/distance-and-odometer.js'
import { playback } from './articles/playback.js'
import { routePlanner } from './articles/route-planner.js'
import { geofences } from './articles/geofences.js'
import { rulesAndAlerts } from './articles/rules-and-alerts.js'
import { eventTypes } from './articles/event-types.js'
import { notificationChannels } from './articles/notification-channels.js'
import { reportTypes } from './articles/report-types.js'
import { scheduledReports } from './articles/scheduled-reports.js'
import { timeZonesAndUnits } from './articles/time-zones-and-units.js'
import { drivers } from './articles/drivers.js'
import { vehicleCard } from './articles/vehicle-card.js'
import { maintenance } from './articles/maintenance.js'
import { plansAndLimits } from './articles/plans-and-limits.js'
import { billingAndInvoices } from './articles/billing-and-invoices.js'
import { unpaidWhatHappens } from './articles/unpaid-what-happens.js'
import { whiteLabelExplained } from './articles/white-label-explained.js'
import { customerAccounts } from './articles/customer-accounts.js'
import { branding } from './articles/branding.js'
import { customDomain } from './articles/custom-domain.js'
import { emailsToYourCustomers } from './articles/emails-to-your-customers.js'
import { apiQuickstart } from './articles/api-quickstart.js'
import { webhooks } from './articles/webhooks.js'
import { whereYourDataLives } from './articles/where-your-data-lives.js'
import { trackingEmployeesLawfully } from './articles/tracking-employees-lawfully.js'
import { exportAndEraseData } from './articles/export-and-erase-data.js'
import { auditLog } from './articles/audit-log.js'
import { deviceNotReporting } from './articles/device-not-reporting.js'
import { mapWontLoad } from './articles/map-wont-load.js'
import { notGettingEmails } from './articles/not-getting-emails.js'

/**
 * Every article, in reading order — the same journey the categories describe, so the index page,
 * the reader's sidebar and the previous/next links all agree without any of them sorting anything.
 *
 * A SEPARATE ENTRY POINT (`@orbetra/kb/content`) from the package root, deliberately: this module
 * pulls in every article in every language, a few hundred kilobytes of prose. The dashboard imports
 * it lazily from its help route, so an operator who never opens the help never downloads it, while
 * the root entry point carries only types, categories, slugs and helpers — which is all a
 * contextual "learn more" link anywhere else in the app actually needs.
 */
export const KB_ARTICLES: readonly KbArticle[] = [
  howTrackingWorks,
  firstSteps,
  loginsAndRoles,
  glossary,
  chooseATracker,
  imei,
  simAndApn,
  connectATracker,
  configSms,
  reportingIntervals,
  commands,
  canAndObd,
  deviceLifecycle,
  mapBasics,
  positionAccuracy,
  deviceStatus,
  shareALiveLink,
  howTripsAreDetected,
  distanceAndOdometer,
  playback,
  routePlanner,
  geofences,
  rulesAndAlerts,
  eventTypes,
  notificationChannels,
  reportTypes,
  scheduledReports,
  timeZonesAndUnits,
  drivers,
  vehicleCard,
  maintenance,
  plansAndLimits,
  billingAndInvoices,
  unpaidWhatHappens,
  whiteLabelExplained,
  customerAccounts,
  branding,
  customDomain,
  emailsToYourCustomers,
  apiQuickstart,
  webhooks,
  whereYourDataLives,
  trackingEmployeesLawfully,
  exportAndEraseData,
  auditLog,
  deviceNotReporting,
  mapWontLoad,
  notGettingEmails,
]
