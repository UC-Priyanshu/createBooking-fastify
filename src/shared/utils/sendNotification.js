async function sendNotification(
    fastify,
    partnerId,
    clientName,
    bookingId,
    isSamePartner
) {
    const { firestore, admin } = fastify.firebase;
    try {
        // Fetch partner document to get their fcmToken
        const partnerDoc = await firestore
            .collection("partner")
            .doc(partnerId)
            .get();
        if (!partnerDoc.exists) {
            return;
        }
        const partnerData = partnerDoc.data();
        const fcmToken = partnerData.fcmtoken;
        if (!fcmToken) {
            return;
        }
        const title = isSamePartner ? `${clientName}` : `New Job - ${clientName}`;
        const body = isSamePartner
            ? "Job Rescheduled"
            : "Confirm job in 10 mins to Avoid cancellation";
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
