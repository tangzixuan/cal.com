/* eslint-disable @typescript-eslint/no-var-requires */

// Import dependencies
const { PrismaClient } = require("@prisma/client");
const dayjs = require("dayjs");
const { google } = require("googleapis");

export const BookingStatus = {
  CANCELLED: "CANCELLED",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  PENDING: "PENDING",
  AWAITING_HOST: "AWAITING_HOST",
} as const;

// Utility function for sleeping
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetches Google credentials
async function getGoogleCredentials(uid: number, prisma: any) {
  const googleCalendarApp = await prisma.app.findUniqueOrThrow({
    where: { slug: "google-calendar" },
  });

  if (!googleCalendarApp?.keys?.client_id || !googleCalendarApp?.keys?.client_secret) {
    throw new Error("Invalid google app credentials");
  }

  const googleCalendarCredential = await prisma.credential.findFirst({
    where: {
      userId: uid,
      appId: "google-calendar",
      type: "google_calendar",
    },
  });

  if (!googleCalendarCredential || googleCalendarCredential?.invalid || !googleCalendarCredential?.key) {
    throw new Error("Invalid Google Calendar credentials");
  }

  return googleCalendarCredential;
}

// Initialize OAuth2 client for Google API
function initializeGoogleOAuthClient(googleCalendarApp: any, googleCalendarCredential: any) {
  const oauth2Client = new google.auth.OAuth2(
    googleCalendarApp.keys.client_id,
    googleCalendarApp.keys.client_secret
  );
  oauth2Client.setCredentials({
    access_token: googleCalendarCredential.key.access_token,
    refresh_token: googleCalendarCredential.key.refresh_token,
  });

  return oauth2Client;
}

// Refreshes the Google OAuth token if expired
async function refreshTokenIfExpired(oauth2Client: any) {
  if (oauth2Client.isTokenExpiring()) {
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
  }
}

// Fetch events from the user's Google Calendar for a specific month
async function fetchGoogleCalendarEvents(
  calendar: any,
  destinationCalendar: any,
  startDate: string,
  endDate: string
) {
  const calendarEvents = await calendar.events.list({
    calendarId: destinationCalendar.externalId,
    timeMin: startDate,
    timeMax: endDate,
    singleEvents: true,
    orderBy: "startTime",
  });

  return calendarEvents.data.items || [];
}

// Fetch user bookings from the database for a specific month
async function fetchUserBookings(uid: number, startDate: string, endDate: string, prisma: any) {
  return await prisma.Booking.findMany({
    where: {
      userId: uid,
      status: BookingStatus.ACCEPTED,
      startTime: {
        gte: startDate,
        lt: endDate,
      },
    },
  });
}

// Create event data to be inserted into the Google Calendar
function createEventData(missingBooking: any, user: any, eventType: any) {
  const guests = missingBooking?.responses?.guests?.length
    ? missingBooking?.responses?.guests?.map?.((email: string) => email)
    : [];
  const attendees = missingBooking?.responses
    ? [
        {
          email: missingBooking?.responses?.email,
          displayName: missingBooking?.responses?.name,
          responseStatus: !eventType?.requiresConfirmation ? "accepted" : "needsAction",
        },
      ]
    : [];

  guests.forEach((g: any) =>
    attendees?.push({
      email: g,
      displayName: g,
      responseStatus: !eventType?.requiresConfirmation ? "accepted" : "needsAction",
    })
  );

  const payload: any = {
    summary: missingBooking.title,
    description: `https://app.cal.com/booking/${missingBooking.uid}`,
    start: { dateTime: missingBooking.startTime, timeZone: user.timeZone },
    end: { dateTime: missingBooking.endTime, timeZone: user.timeZone },
    location: missingBooking?.metadata?.videoCallUrl ?? missingBooking?.location ?? "",
    attendees: [],
  };

  if (eventType.hideCalendarEventDetails) {
    payload.visibility = "private";
  }

  return payload;
}

// Add event to Google Calendar
async function addEventToGoogleCalendar(calendar: any, destinationCalendar: any, eventData: any) {
  try {
    const response = await calendar.events.insert({
      calendarId: destinationCalendar.externalId,
      requestBody: eventData,
    });
    console.log("Event successfully inserted");
    return response;
  } catch (err) {
    console.error("Error inserting event", eventData, err);
  }
}

// Main function to add bookings to Google Calendar
async function main(uid: number, month: number, year: number) {
  const prisma = new PrismaClient();
  try {
    const googleCalendarCredential = await getGoogleCredentials(uid, prisma);
    const googleCalendarApp = await prisma.app.findUniqueOrThrow({ where: { slug: "google-calendar" } });

    const oauth2Client = initializeGoogleOAuthClient(googleCalendarApp, googleCalendarCredential);
    await refreshTokenIfExpired(oauth2Client);
    const calendar = google.calendar({ version: "v3", auth: oauth2Client });

    const user = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
    const destinationCalendar = await prisma.destinationCalendar.findFirst({
      where: {
        credentialId: googleCalendarCredential.id,
        integration: "google_calendar",
      },
    });

    if (!destinationCalendar) throw new Error("No Google Calendar destination found");

    const formattedMonth = month < 10 ? `0${month}` : `${month}`;

    const startDate = dayjs(`${year}-${formattedMonth}-10T00:00:00Z`).toISOString();
    const endDate = dayjs(startDate).endOf("month").toISOString();

    const calendarEvents = await fetchGoogleCalendarEvents(calendar, destinationCalendar, startDate, endDate);

    const userBookings = await fetchUserBookings(uid, startDate, endDate, prisma);
    const missingBookings = userBookings.filter(
      (booking: any) =>
        !calendarEvents.find(
          (event: any) =>
            event.summary === booking.title &&
            (booking?.metadata?.videoCallUrl
              ? event.location === booking?.metadata?.videoCallUrl
              : event.location === booking?.location)
        )
    );
    console.log("Missing Bookings:", missingBookings?.length ?? 0);
    console.log("calendar", destinationCalendar.externalId);
    console.log("crdential", googleCalendarCredential.id);

    for (const missingBooking of missingBookings) {
      const eventType = await prisma.eventType.findFirst({ where: { id: missingBooking.eventTypeId } });
      const eventData = createEventData(missingBooking, user, eventType);
      const createdEvent = await addEventToGoogleCalendar(calendar, destinationCalendar, eventData);
      if (createdEvent?.data?.id) {
        try {
          const alreadyExistingRef = await prisma.bookingReference.findFirst({
            where: {
              type: "google_calendar",
              credentialId: googleCalendarCredential.id,
              bookingId: missingBooking.id,
              OR: [{ deleted: null }, { deleted: false }],
              externalCalendarId: destinationCalendar.externalId,
            },
          });
          if (alreadyExistingRef?.id) {
            console.log("Update existing ref");
            await prisma.bookingReference.update({
              where: {
                id: alreadyExistingRef.id,
              },
              data: {
                type: "google_calendar",
                uid: createdEvent?.data?.id,
                meetingId: createdEvent?.data?.id,
                externalCalendarId: destinationCalendar.externalId,
                deleted: false,
                booking: { connect: { id: missingBooking.id } },
                credential: { connect: { id: googleCalendarCredential.id } },
              },
            });
          } else {
            await prisma.bookingReference.create({
              data: {
                type: "google_calendar",
                uid: createdEvent?.data?.id,
                meetingId: createdEvent?.data?.id,
                externalCalendarId: destinationCalendar.externalId,
                deleted: false,
                booking: { connect: { id: missingBooking.id } }, // Explicit connection
                credential: { connect: { id: googleCalendarCredential.id } },
              },
            });
          }
        } catch (err) {
          console.error("Could not create reference for", missingBooking.uid, err);
        }
      }

      await sleep(100); // Delay between adding events
    }
  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

async function fixMissingGoogleEvents(month: number, year: number) {
  const prisma = new PrismaClient();
  const formattedMonth = month < 10 ? `0${month}` : `${month}`;
  const startDate = dayjs(`${year}-${formattedMonth}-10T00:00:00Z`).toISOString();
  const endDate = dayjs(startDate).endOf("month").toISOString();

  const missingEventsReferences = await prisma.bookingReference.findMany({
    where: {
      type: "google_calendar",
      meetingId: null,
      OR: [{ deleted: null }, { deleted: false }],
      booking: {
        status: BookingStatus.ACCEPTED,
        startTime: {
          gte: startDate,
          lt: endDate,
        },
      },
    },
    include: { booking: true },
  });

  const uniqueUserIds = [
    ...new Set(missingEventsReferences.map((ref: any) => ref.booking?.userId).filter(Boolean)),
  ];

  await prisma.$disconnect();

  for (let index = 0; index < uniqueUserIds.length; index++) {
    const element = uniqueUserIds[index];
    if (typeof element === "number" && month) {
      try {
        await main(element as number, month, year);
        console.log("Fixed event for:", element);
      } catch (err) {
        console.log("Failed for: ", element);
      }
    }
  }
}

// Parse arguments from the command line
const monthArgIndex = process.argv.findIndex((v) => v === "-month");
const month = Number(process.argv[monthArgIndex + 1]);

const yearArgIndex = process.argv.findIndex((v) => v === "-year");
const year = Number(process.argv[yearArgIndex + 1]);
if (month && year) {
  fixMissingGoogleEvents(month, year);
} else {
  console.log("Provide month with flag -month (number)");
}
