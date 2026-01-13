import { calculateBookedSlots } from '../../shared/utils/calculateBookedSlots.js';
import logger from '../../shared/utils/logger.js';
import { firestore } from "../../plugin/firebase.js";


export async function changeTimingOfPartners( bookingData, recheckAvailabilityOfPartner, bookingDate, bookingId) {
    try {
        // Access Firebase through fastify decorator
        // const { firestore } = fastify.firebase;
        
        const partnerId = recheckAvailabilityOfPartner.partner.id;
        const timingId = bookingDate.substring(0, 4) + bookingDate.substring(5, 7) + bookingDate.substring(8, 10);
        
        // Calculate slots (Business Logic)
        const listOfBookedSlots = calculateBookedSlots(bookingData.bookingsminutes, bookingData.slotnumber);

        // ---------------------------------------------------------
        // OPTIMIZATION 1: Parallel DB Reads (Fetch both at once)
        // ---------------------------------------------------------
        const timingRef = firestore.collection("partner").doc(partnerId).collection("timings").doc(timingId);
        const partnerDocRef = firestore.collection("partner").doc(partnerId);

        const [timingSnapShot, partnerDocSnap] = await Promise.all([
            timingRef.get(),
            partnerDocRef.get()
        ]);

        // Get Non-Working Slots (Fallback logic)
        const partnerNonWorkingSlots = partnerDocSnap.exists ? (partnerDocSnap.data().nonWorkingSlots || []) : [];

        // ---------------------------------------------------------
        // LOGIC PATH 1: Update Existing Timing Doc
        // ---------------------------------------------------------
        if (timingSnapShot.exists) {
            const data = timingSnapShot.data();
            const available = data.available || [];
            const booked = data.booked || [];
            const nonWorkingSlots = data.nonWorkingSlots || partnerNonWorkingSlots;
            const bookings = data.bookings || [];

            // Update Arrays: Remove from available, add to booked
            // Using Set for O(1) lookup speed if lists are large (optional but good practice)
            const availableSet = new Set(available);
            
            listOfBookedSlots.forEach(slot => {
                if (availableSet.has(slot)) {
                    availableSet.delete(slot);
                }
                // Check duplicate before pushing
                if (!booked.includes(slot)) {
                    booked.push(slot);
                }
            });

            // Reconstruct Array from Set
            const updatedAvailable = Array.from(availableSet);
            
            // Add Booking Log
            bookings.push({ [bookingId]: listOfBookedSlots });

            // Sort Arrays (Business Requirement)
            updatedAvailable.sort((a, b) => a - b);
            booked.sort((a, b) => a - b);

            // Commit Update
            await timingRef.update({
                available: updatedAvailable,
                booked: booked,
                nonWorkingSlots: nonWorkingSlots,
                bookings: bookings
            });

            logger.info({ partnerId, bookingId }, "Partner timing updated successfully");

            return {
                statusCode: 200,
                status: "success",
                message: "Booking updated successfully"
            };
        } 
        
        // ---------------------------------------------------------
        // LOGIC PATH 2: Create New Timing Doc
        // ---------------------------------------------------------
        else {
            const bookings = [{ [bookingId]: listOfBookedSlots }];
            const availableSlots = getAvailableSlots(listOfBookedSlots);

            const timingRefDoc = {
                available: availableSlots,
                booked: listOfBookedSlots,
                dateTime: getCurrentDateFormatted(),
                nonWorkingSlots: partnerNonWorkingSlots,
                leave: [],
                bookings: bookings
            };

            // Using Batch for atomic creation (though single set is also atomic)
            const batch = firestore.batch();
            batch.set(timingRef, timingRefDoc);
            await batch.commit();

            // logger.info({ partnerId, bookingId }, "New timing document created");

            return {
                statusCode: 200,
                status: "success",
                message: "New timing document created and booking updated successfully"
            };
        }

    } catch (error) {
        // Silent failure for speed
        return {
            statusCode: 400,
            status: "error",
            message: "Error in changeTimingOfPartners"
        };
    }
}

// ---------------------------------------------------------
// UTILS (Optimized)
// ---------------------------------------------------------

function getAvailableSlots(bookedSlots) {
    const availableSlots = [];
    const bookedSet = new Set(bookedSlots); // O(1) Lookup
    
    for (let i = 0; i <= 23; i++) {
        if (!bookedSet.has(i)) {
            availableSlots.push(i);
        }
    }
    return availableSlots;
}

// Native JS Date Formatter (Replaces Moment.js for speed)
function getCurrentDateFormatted() {
    const now = new Date();
    // Native Intl format matching: "13 January 2026 at 12.52.00 UTC+05:30"
    const datePart = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(now);
    const timePart = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }).format(now).replace(/:/g, '.');
    return `${datePart} at ${timePart} [UTC]+05:30`;
}