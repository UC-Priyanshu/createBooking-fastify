import { admin, firestore, GeoFirestore } from "../../../plugin/firebase.js";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
// import logger from "../../utils/logger";

function convertYYYYMMDDToDate(yyyymmdd) {
    if (typeof yyyymmdd !== 'string' || yyyymmdd.length !== 8) {
        throw new Error("Invalid input: Expected a string in 'yyyymmdd' format");
    }

    const year = parseInt(yyyymmdd.substring(0, 4), 10);
    const month = parseInt(yyyymmdd.substring(4, 6), 10) - 1; // Month is 0-based in JS
    const day = parseInt(yyyymmdd.substring(6, 8), 10);

    return new Date(year, month, day);
}

async function initMissedLeads(partnerMissedLeadReasonListOfMap, bookingData, bookingDate) {

    for (let i = 0; i < partnerMissedLeadReasonListOfMap.length; i++) {
        try {
            const partner = partnerMissedLeadReasonListOfMap[i];
            const partnerId = partner.partner;
            const bookingId = bookingData.bookingid;
            const orderId = bookingData.orderId;
            const clientAddress = bookingData.address;
            const clientName = bookingData.name;
            const priceToPay = bookingData.priceToPay;
            const reason = partnerMissedLeadReasonListOfMap[i].reason;
            const bookedSlots = bookingData.listofbookedslots;
            const formatedBookingDate = convertYYYYMMDDToDate(bookingDate.replace(/-/g, ''));
            // logger.info({line: 13, partnerId, formatedBookingDate, bookingId, orderId});
            await initMissedLeadForPartner(partnerId, formatedBookingDate, bookingId, orderId, reason, clientAddress, clientName, priceToPay, bookedSlots);
            await sendNotificationForMissedLeads(partnerId, reason);
        } catch (e) {
            // logger.info({line: 19, e});
        }
    }

}


async function sendNotificationForMissedLeads(partnerId, reason) {
    try {
        // Fetch partner document to get their fcmToken
        const partnerDoc = await firestore
            .collection("partner")
            .doc(partnerId)
            .get();
        if (!partnerDoc.exists) {
            // logger.info(`Partner not found for missed lead notification: ${partnerId}`);
            return;
        }
        const partnerData = partnerDoc.data();
        const fcmToken = partnerData.fcmtoken;
        if (!fcmToken) {
            // logger.info(`No fcmToken found for partner: ${partnerId}`);
            return;
        }


        let finalReason = "";
        if (reason.includes('Non working slots')) {
            finalReason = 'Non working slots';
        } else if (reason.includes('leave')) {
            finalReason = 'on Leave';
        }
        const title = "Missed Lead";
        const body = `You have missed a lead due to ${finalReason}`;
        const channelId = "missed_lead";

        const message = {
            token: fcmToken, notification: {
                title: title, body: body,
            }, data: {
                type: "missedLeadNotification",
            }, android: {
                priority: "high", notification: {
                    sound: "sound", channelId: channelId,
                },
            },
        };

        const response = await admin.messaging().send(message);
        // logger.info("Missed lead Notification sent successfully:", response);
    } catch (error) {
        // logger.warn("Error sending notification:", error);
        throw error;
    }
}


async function initMissedLeadForPartner(partnerId, bookingDate, bookingId, orderId, reason, clientAddress, clientName, amount, bookedSlots) {
    try {
        const missedLeadRef = firestore
            .collection('partner')
            .doc(partnerId)
            .collection('performance')
            .doc('missedLeads')
            .collection('all')
            .doc(orderId);

        const payload = {
            bookingDate, bookingId, orderId, reason, address: clientAddress, name: clientName, amount, bookedSlots, // keep these server-driven timestamps
            createdAt: FieldValue.serverTimestamp(), missedAt: FieldValue.serverTimestamp(),
        };

        // Upsert logic via transaction so we don't violate read-before-write rule
        await firestore.runTransaction(async (tx) => {
            const snap = await tx.get(missedLeadRef);

            if (snap.exists) {
                // Update only relevant fields, do not override createdAt
                tx.update(missedLeadRef, {
                    bookingDate,
                    missedAt: FieldValue.serverTimestamp(),
                    reason,
                    address: clientAddress,
                    name: clientName,
                    amount,
                    bookedSlots,
                });
                // logger.info(`[MissedLead][update] partner=${partnerId} orderId=${orderId}`);
            } else {
                tx.set(missedLeadRef, payload);
                // logger.info(`[MissedLead][create] partner=${partnerId} orderId=${orderId}`);
            }
        });

    } catch (e) {
        // logger.error(`[MissedLead] Error in initMissedLeadForPartner: ${e?.message || e}`);
        throw e;
    }
}

export { initMissedLeads };