import admin from "firebase-admin";
import { firestore } from "../../plugin/firebase.js";
// import logger from "./logger.js";
/**
 * Send notification to a partner about a new or rescheduled booking.
 * @param {string} partnerId - The ID of the partner receiving the notification.
 * @param {string} clientName - The client's name to display in notification body.
 * @param {string} bookingId - The booking ID to send as data in the notification.
 * @param {boolean} isSamePartner - Whether this is a rescheduled job or a new booking.
 */
async function sendNotification(
    partnerId,
    clientName,
    bookingId,
    isSamePartner
) {
    try {
        // Fetch partner document to get their fcmToken
        const partnerDoc = await firestore
            .collection("partner")
            .doc(partnerId)
            .get();
        if (!partnerDoc.exists) {
            // logger.info(`Partner not found for notification: ${partnerId}`);
            return;
        }
        const partnerData = partnerDoc.data();
        const fcmToken = partnerData.fcmtoken;
        if (!fcmToken) {
            // logger.info(`No fcmToken found for partner: ${partnerId}`);
            return;
        }
        const title = isSamePartner ? `${clientName}` : `New Job - ${clientName}`;
        const body = isSamePartner
            ? "Job Rescheduled"
            : "Confirm job in 10 mins to Avoid cancellation";
        // Use "newJob" channel if booking is transferred to a new partner
        // Use "reschedule" channel if the same partner is assigned again
        const channelId = isSamePartner ? "job_rescheduled" : "job_createbooking";

        const message = {
            token: fcmToken,
            notification: {
                title: title,
                body: body,
            },
            data: {
                bookingId: bookingId,
            },
            android: {
                priority: "high",
                notification: {
                    sound: "sound",
                    channelId: channelId,
                },
            },
        };
        if (!isSamePartner) {
            await firestore.collection("BOOKINGS").doc(bookingId).update({
                New_booking_notifcation_received: false,
            });
        }

        const response = await admin.messaging().send(message);
        // logger.info("Notification sent successfully:", response);
    } catch (error) {
        // logger.warn("Error sending notification:", error);
    }
}

export { sendNotification };
