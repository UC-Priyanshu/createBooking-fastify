import { DocumentReference } from "firebase-admin/firestore";
import fetchBookingDetailsfromDB from "../../shared/utils/fetchBookingDetailsfromDB/index.js";
import getSlotMapAndStatus from "../../shared/utils/getSlotMapAndStatus/index.js";
import prioritizePartners from "../../shared/utils/prioritizePartners/index.js";
import recheckAvailabilityOfPartner from "../../shared/utils/recheckAvailabilityOfPartner/index.js";
import { processReschedulingBooking } from "./processReschedulingBooking.js";
import { sendNotification } from "../../shared/utils/sendNotification.js";

/**
 * Main Reschedule Service
 * Logic remains exactly the same, but optimized for speed and Fastify.
 */
export default async function rescheduleBooking(
  preferredPartner,
  bookingDate,
  rescheduleData,
  reply // Pass Fastify 'reply' object instead of Express 'res'
) {
  // Use Fastify's request logger for better tracing (includes Req ID)
  // If reply.request is not available, fallback to console
  const log = reply.request ? reply.request.log : console;

  try {
    // 1. Fetch Booking
    const booking = await fetchBookingDetailsfromDB(rescheduleData.bookingId);

    if (booking.statusCode === 404) {
      return reply.code(404).send(booking);
    }

    // 2. Validate Reschedule Limit (Business Logic)
    if (booking.data.reschedule && rescheduleData.role === "client") {
      const clientRescheduleCount = booking.data.reschedule.filter(
        (r) => r.rescheduleBy === "client"
      ).length;

      if (clientRescheduleCount >= 2) {
        log.warn({ bookingId: rescheduleData.bookingId }, "Max reschedule limit reached");
        return reply.code(400).send({
          statusCode: 400,
          status: "failed",
          message: "Booking can't be rescheduled more than 2 times.",
        });
      }
    }

    // 3. Get Slot Map (Parallelizable logic kept sequential as per original strict flow)
    const slotMapAndStatus = await getSlotMapAndStatus(
      booking.data,
      preferredPartner,
      bookingDate,
      rescheduleData
    );

    if (slotMapAndStatus.statusCode !== 200) {
      log.warn({ msg: "Slot map not found", error: slotMapAndStatus });
      return reply.code(400).send({
        statusCode: 400,
        status: "Unknown",
        message: "Unknown Error Occurs in Finding SlotsMap.",
      });
    }

    // 4. Recheck & Assign
    const oldPartnerId = booking.data.assignedpartnerid;
    const finalBookingStatus = await recheckAndAssignPartnerToBooking(
      slotMapAndStatus.slotMap,
      booking.data,
      bookingDate,
      rescheduleData,
      preferredPartner,
      log // Pass logger down to avoid global logger overhead
    );

    // 5. Final Response Handling
    if (finalBookingStatus.statusCode === 200) {
      const newPartnerId = finalBookingStatus.newPartnerRef.id;
      const isSamePartner = newPartnerId === oldPartnerId;

      // Non-blocking notification (Fire and forget to speed up response)
      sendNotification(
        newPartnerId,
        booking.data.name,
        booking.data.orderId,
        isSamePartner
      ).catch(err => log.error({ err }, 'Notification failed'));

      return reply.code(200).send({
        statusCode: finalBookingStatus.statusCode,
        status: finalBookingStatus.status,
        message: finalBookingStatus.message,
      });
    } else {
      return reply.code(400).send(finalBookingStatus);
    }

  } catch (error) {
    log.error({ err: error }, "Critical error in rescheduleBooking");
    return reply.code(500).send({ 
        message: "Internal Server Error", 
        error: error.message 
    });
  }
}

/**
 * Helper: Recheck and Assign
 * Kept separate to maintain your exact logic flow.
 */
async function recheckAndAssignPartnerToBooking(
  slotMap,
  bookingData,
  bookingDate,
  rescheduleData,
  preferredPartner,
  log
) {
  try {
    const coordinates = {
      latitude: bookingData.latitude,
      longitude: bookingData.longitude,
    };

    // Step 1: Prioritize
    let prioritizedPartners = await prioritizePartners(
      slotMap.availablePartners,
      coordinates,
      bookingDate,
      rescheduleData,
      preferredPartner
    );

    // Logic: Assign Previous Partner if applicable
    if (
      rescheduleData?.status === true &&
      preferredPartner === "none"
    ) {
      prioritizedPartners = prioritizePartnersAccordingToPreviousPartner(
        prioritizedPartners,
        bookingData.previousPartner,
        bookingData.assigned
      );
    }

    // Step 2: Recheck Availability
    const recheckPartnersAvailability = await recheckAvailabilityOfPartner(
      slotMap["slot no."],
      prioritizedPartners,
      bookingDate,
      bookingData,
      rescheduleData
    );

    if (recheckPartnersAvailability.statusCode === 400) {
      return recheckPartnersAvailability;
    }

    if (recheckPartnersAvailability.availablityStatus) {
      // Step 3: Process Reschedule
      const finalBookingStatus = await processReschedulingBooking(
        recheckPartnersAvailability,
        bookingData,
        bookingDate,
        rescheduleData
      );

      if (finalBookingStatus.statusCode === 200) {
        return finalBookingStatus;
      }
      return {
        statusCode: 400,
        status: "Unknown",
        message: "Error occurs in rescheduling.",
      };
    }

    return {
      statusCode: 400,
      status: "Unknown",
      message: "Error occurs in rechecking and Assigning Partner. Booking is Dead.",
    };

  } catch (error) {
    log.error({ err: error }, "Error in recheckAndAssignPartnerToBooking");
    return {
      statusCode: 400,
      status: "Unknown",
      message: "Error occurs in rechecking and Assigning Partner.",
    };
  }
}

/**
 * Helper: Optimized Sorting
 * OPTIMIZATION: Uses HashMap for O(1) lookup instead of O(n) indexOf inside sort.
 */
function prioritizePartnersAccordingToPreviousPartner(
  prioritizedPartners,
  previousPartnerList,
  assigned
) {
  if (!previousPartnerList || previousPartnerList.length === 0) {
    return prioritizedPartners;
  }

  try {
    // 1. Create a Set for fast existence check O(1)
    const previousPartnerIds = new Set(previousPartnerList.map((p) => p.id));
    
    // 2. Create a Map for fast index lookup O(1)
    // { "partnerA": 0, "partnerB": 1 }
    const indexMap = new Map();
    previousPartnerList.forEach((p, index) => indexMap.set(p.id, index));

    // Logic A: If counts match (Original logic maintained)
    if (prioritizedPartners.length === previousPartnerList.length) {
      const assignedIndex = previousPartnerList.findIndex((p) => p.id === assigned.id);
      
      const priorityPartners = prioritizedPartners.filter((p) => previousPartnerIds.has(p.id));
      
      // Fast Sort using Map
      priorityPartners.sort((a, b) => {
        return (indexMap.get(a.id) || 0) - (indexMap.get(b.id) || 0);
      });

      const part1 = priorityPartners.slice(0, assignedIndex + 1);
      const part2 = priorityPartners.slice(assignedIndex + 1);
      return part2.concat(part1);
    }

    // Logic B: Complex filtering (Original logic optimized)
    const sortedPrioritizedPartners = [...prioritizedPartners].sort((a, b) => {
         // Use Map for speed instead of array.indexOf
         const idxA = indexMap.has(a.id) ? indexMap.get(a.id) : 9999;
         const idxB = indexMap.has(b.id) ? indexMap.get(b.id) : 9999;
         return idxA - idxB;
    });

    // Single pass filtering is hard here due to specific order requirements, 
    // keeping original filter logic but on the pre-sorted list.
    const removeAssigned = [];
    const previous = [];
    const notPrevious = [];

    for (const partner of sortedPrioritizedPartners) {
        if (partner.id === assigned.id) {
            removeAssigned.push(partner);
        } else if (previousPartnerIds.has(partner.id)) {
            previous.push(partner);
        } else {
            notPrevious.push(partner);
        }
    }

    return [...notPrevious, ...previous, ...removeAssigned];

  } catch (error) {
    console.error("Sorting error", error); // Fallback log
    return prioritizedPartners;
  }
}