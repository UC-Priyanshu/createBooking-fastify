import * as geofire from 'geofire-common';
import { calculateBookedSlots } from '../../shared/utils/calculateBookedSlots.js';
import { sendNotification } from '../../shared/utils/sendNotification.js';
// import logger from '../../shared/utils/logger.js';
import { firestore, admin, FieldValue  } from "../../plugin/firebase.js";


export async function assignBookingToPartner(
    // fastify, // Add fastify parameter to access Firebase
    bookingData,
    preferredPartner,
    recheckPartnersAvailability,
    bookingDate,
    rescheduleData
) {
    try {
        // Access Firebase through fastify decorator
        // const { firestore, FieldValue, admin } = fastify.firebase;
        const GeoPoint = admin.firestore.GeoPoint;

        const currentPartner = recheckPartnersAvailability.partner;
        const isReschedule = rescheduleData?.status === true;

        // ---------------------------------------------------------
        // OPTIMIZATION 1: Parallel DB Reads (Fetches both docs at once)
        // ---------------------------------------------------------
        const partnerRef = firestore.collection("partner").doc(currentPartner.id);

        // We only need the Count doc if it's a NEW booking
        const countRefPromise = isReschedule
            ? Promise.resolve(null)
            : firestore.collection("BOOKINGS").doc("COUNTS").get();

        const [partnerSnap, countSnap] = await Promise.all([
            partnerRef.get(),
            countRefPromise
        ]);

        if (!partnerSnap.exists) {
            return { status: "error", message: "Partner not found" };
        }

        const partnerData = partnerSnap.data();

        // ---------------------------------------------------------
        // Logic: Prepare Data
        // ---------------------------------------------------------
        const assigned = {
            hubId: partnerData.hubIds,
            id: currentPartner.id,
            name: partnerData.name,
            phone: partnerData.phone,
            profileUrl: partnerData.profileUrl,
            rating: partnerData.avgrating?.toString() || "5",
        };

        const assignedpartnerid = currentPartner.id;
        const finalCredits = Math.round(bookingData.priceToPay / 50);

        // Calculate Slots
        const slotNumber = isReschedule ? rescheduleData.rescheduleSlotNumber : bookingData.slotnumber;
        const listOfBookedSlots = calculateBookedSlots(bookingData.bookingsminutes, slotNumber);

        // Calculate Booking ID (Only for new bookings)
        let bookingid = bookingData.bookingid; // Keep existing if reschedule
        if (!isReschedule && countSnap) {
            // Note: This counter strategy is not concurrency-safe for 1000+ users/sec, 
            // but keeping logic same as requested.
            bookingid = (countSnap.data().count || 0) + 1;
        }

        // ---------------------------------------------------------
        // Update Booking Data Object (Mutation)
        // ---------------------------------------------------------
        // Constructing the object properties directly
        Object.assign(bookingData, {
            bookingid: bookingid,
            assigned: assigned,
            assignedpartnerid: assignedpartnerid,
            bookingdate: new Date(bookingDate),
            listofbookedslots: listOfBookedSlots,
            createdat: FieldValue.serverTimestamp(),
            bookingdateIsoString: new Date(bookingDate).toISOString(),
            point: new GeoPoint(bookingData.latitude, bookingData.longitude),
            geoHash: geofire.geohashForLocation([bookingData.latitude, bookingData.longitude]),
            credits: finalCredits,
            status: "pending",
            preferredPartner: preferredPartner ?? "",
            ...(isReschedule && { slotnumber: slotNumber }) // Conditionally add slotnumber
        });
        console.log("Final Booking Data:", bookingData);
        // ---------------------------------------------------------
        // DB Write: Batch Commit
        // ---------------------------------------------------------
        const batch = firestore.batch();
        const docRef = firestore.collection("BOOKINGS").doc(bookingData.orderId);

        if (isReschedule) {
            batch.update(docRef, bookingData);
        } else {
            const countRef = firestore.collection("BOOKINGS").doc("COUNTS");
            batch.set(countRef, { count: bookingid }, { merge: true });
            batch.set(docRef, bookingData);
        }

        await batch.commit();

        // ---------------------------------------------------------
        // OPTIMIZATION 2: Fire-and-Forget Notification
        // ---------------------------------------------------------
        // Do NOT await this. Return response to user immediately.
        // The notification will send in the background.
        sendNotification(assignedpartnerid, bookingData.name, bookingData.orderId, isReschedule)
            .catch(err => { });
        // .catch(err => logger.error({ err }, "Notification failed in background"));

        // ---------------------------------------------------------
        // Return Response
        // ---------------------------------------------------------
        return {
            statusCode: 200,
            status: "Placed",
            message: isReschedule
                ? "Booking is successfully rescheduled and assigned to a new partner."
                : "Booking is successfully placed and assigned to a partner.",
            bookingId: bookingid,
            partnerId: assignedpartnerid
        };

    } catch (error) {
        console.error("Error in assignBookingToPartner:", error.message, error.stack);
        return {
            status: "error",
            message: "Error in assignBookingToPartner: " + error.message
        };
    }
}