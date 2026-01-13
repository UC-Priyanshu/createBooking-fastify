import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { firestore } from "../../plugin/firebase.js";
// import logger from "./logger.js";

function toDDMMYYYY(d) {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}${mm}${yyyy}`;
}

function convertYYYYMMDDToDate(yyyymmdd) {
    if (typeof yyyymmdd !== 'string' || yyyymmdd.length !== 8) {
        throw new Error("Invalid input: Expected a string in 'yyyymmdd' format");
    }

    const year = parseInt(yyyymmdd.substring(0, 4), 10);
    const month = parseInt(yyyymmdd.substring(4, 6), 10) - 1; // Month is 0-based in JS
    const day = parseInt(yyyymmdd.substring(6, 8), 10);

    return new Date(year, month, day);
}

async function handleLogs(partnerId, bookingDate, orderId, bookingId, amount, status, ratedByPartner = null, ratedByClient = null, reviews = null) {
    const logPrefix = `[HandleLogs][Order:${orderId}][Booking:${bookingId}]`;

    try {
        const docRef = firestore
            .collection('partner')
            .doc(partnerId)
            .collection('performance')
            .doc('bookingLogs');

        await firestore.runTransaction(async (tx) => {
            const snap = await tx.get(docRef);
            const finalBookingDate = convertYYYYMMDDToDate(bookingDate);
            const today = toDDMMYYYY(finalBookingDate); // e.g., 29072025

            let logs = snap.exists && snap.data()?.logs ? snap.data().logs : {};

            const bookingEntry = {
                bookingId,
                orderId,
                status,
                bookingDate: finalBookingDate,
                amount,
                ratedByPartner: ratedByPartner ?? null,
                ratedByClient: ratedByClient ?? null,
                reviews: reviews ?? null,
            };

            // If log for the day exists
            if (logs[today]) {
                const dayLog = logs[today];
                const existingBookingIdx = dayLog.bookings.findIndex(b => b.bookingId === bookingId);

                if (existingBookingIdx !== -1) {
                    // Update existing booking
                    const existingBooking = dayLog.bookings[existingBookingIdx];
                    existingBooking.status = status;
                    existingBooking.ratedByPartner = ratedByPartner ?? existingBooking.ratedByPartner;
                    existingBooking.ratedByClient = ratedByClient ?? existingBooking.ratedByClient;
                    existingBooking.reviews = reviews ?? existingBooking.reviews;
                } else {
                    // Add new booking and update amount
                    dayLog.bookings.push(bookingEntry);
                    dayLog.amount += amount;
                }

                dayLog.updatedAt = FieldValue.serverTimestamp();
            } else {
                // New day log
                logs[today] = {
                    amount: amount,
                    bookings: [bookingEntry],
                    updatedAt: FieldValue.serverTimestamp()
                };
            }

            // Write logs
            tx.set(docRef, {logs}, {merge: true});
        });

        // logger.info(`${logPrefix} Booking log updated successfully.`);
    } catch (e) {
        // logger.error(`${logPrefix} Error while logging booking:`, e);
    }
}

export { handleLogs };