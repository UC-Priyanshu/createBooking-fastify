import { DocumentReference } from "firebase-admin/firestore";
import fetchBookingDetailsfromDB from "../../shared/utils/fetchBookingDetailsfromDB/index.js";
import getSlotMapAndStatus from "../../shared/utils/getSlotMapAndStatus/index.js";
import prioritizePartners from "../../shared/utils/prioritizePartners/index.js";
import recheckAvailabilityOfPartner from "../../shared/utils/recheckAvailabilityOfPartner/index.js";
import { processReschedulingBooking } from "./processReschedulingBooking.js";
import { sendNotification } from "../../shared/utils/sendNotification.js";

export default async function rescheduleBooking(
  fastify,
  preferredPartner,
  bookingDate,
  rescheduleData
) {

  try {
    const booking = await fetchBookingDetailsfromDB(fastify, rescheduleData.bookingId);

    if (booking.statusCode === 404) {
      return {
        statusCode: 404,
        status: "failed",
        message: booking.message
      };
    }

    fastify.log.info({ 
      bookingId: rescheduleData.bookingId,
      hasAssignedPartner: !!booking.data.assignedpartnerid,
      hasBookingDate: !!booking.data.bookingdateIsoString,
      bookingStatus: booking.data.status
    }, "Fetched booking for reschedule");

    if (booking.data.reschedule && rescheduleData.role === "client") {
      const clientRescheduleCount = booking.data.reschedule.filter(
        (r) => r.rescheduleBy === "client"
      ).length;

      if (clientRescheduleCount >= 2) {
        fastify.log.warn({ bookingId: rescheduleData.bookingId }, "Max reschedule limit reached");
        return {
          statusCode: 400,
          status: "failed",
          message: "Booking can't be rescheduled more than 2 times."
        };
      }
    }

    const slotMapAndStatus = await getSlotMapAndStatus(
      booking.data,
      preferredPartner,
      bookingDate,
      rescheduleData
    );

    if (slotMapAndStatus.statusCode !== 200) {
      fastify.log.warn({ msg: "Slot map not found", error: slotMapAndStatus });
      return {
        statusCode: 400,
        status: "Unknown",
        message: "Unknown Error Occurs in Finding SlotsMap."
      };
    }

    const oldPartnerId = booking.data.assignedpartnerid;
    const finalBookingStatus = await recheckAndAssignPartnerToBooking(
      fastify,
      slotMapAndStatus.slotMap,
      booking.data,
      bookingDate,
      rescheduleData,
      preferredPartner
    );

    if (finalBookingStatus.statusCode === 200) {
      const newPartnerId = finalBookingStatus.newPartnerRef.id;
      const isSamePartner = newPartnerId === oldPartnerId;

      sendNotification(
        newPartnerId,
        booking.data.name,
        booking.data.orderId,
        isSamePartner
      ).catch(err => fastify.log.error({ err }, 'Notification failed'));

      return {
        statusCode: 200,
        status: finalBookingStatus.status,
        message: finalBookingStatus.message,
        bookingId: booking.data.orderId
      };
    } else {
      return finalBookingStatus;
    }

  } catch (error) {
    fastify.log.error({ err: error }, "Critical error in rescheduleBooking");
    return {
      statusCode: 500,
      status: "Error",
      message: "Internal Server Error",
      error: error.message
    };
  }
}


async function recheckAndAssignPartnerToBooking(
  fastify,
  slotMap,
  bookingData,
  bookingDate,
  rescheduleData,
  preferredPartner
) {
  try {
    const coordinates = {
      latitude: bookingData.latitude,
      longitude: bookingData.longitude,
    };

    let prioritizedPartners = await prioritizePartners(
      fastify,
      slotMap.availablePartners,
      coordinates,
      bookingDate,
      rescheduleData,
      preferredPartner
    );

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

    const recheckPartnersAvailability = await recheckAvailabilityOfPartner(
      fastify,
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
      const finalBookingStatus = await processReschedulingBooking(
        fastify, 
        recheckPartnersAvailability,
        bookingData,
        bookingDate,
        rescheduleData
      );

      if (finalBookingStatus.statusCode === 200) {
        return finalBookingStatus;
      }
      
      // Log the actual error from processReschedulingBooking
      fastify.log.error({ 
        finalBookingStatus, 
        bookingId: bookingData.orderId 
      }, "processReschedulingBooking failed");
      
      return {
        statusCode: finalBookingStatus.statusCode || 400,
        status: finalBookingStatus.status || "Unknown",
        message: finalBookingStatus.message || "Error occurs in rescheduling.",
        error: finalBookingStatus.error
      };
    }

    return {
      statusCode: 400,
      status: "Unknown",
      message: "Error occurs in rechecking and Assigning Partner. Booking is Dead.",
    };

  } catch (error) {
    fastify.log.error({ err: error }, "Error in recheckAndAssignPartnerToBooking");
    return {
      statusCode: 400,
      status: "Unknown",
      message: "Error occurs in rechecking and Assigning Partner.",
    };
  }
}


function prioritizePartnersAccordingToPreviousPartner(
  prioritizedPartners,
  previousPartnerList,
  assigned
) {
  if (!previousPartnerList || previousPartnerList.length === 0) {
    return prioritizedPartners;
  }

  try {
    const previousPartnerIds = new Set(previousPartnerList.map((p) => p.id));

    const indexMap = new Map();
    previousPartnerList.forEach((p, index) => indexMap.set(p.id, index));

    if (prioritizedPartners.length === previousPartnerList.length) {
      const assignedIndex = previousPartnerList.findIndex((p) => p.id === assigned.id);

      const priorityPartners = prioritizedPartners.filter((p) => previousPartnerIds.has(p.id));

      priorityPartners.sort((a, b) => {
        return (indexMap.get(a.id) || 0) - (indexMap.get(b.id) || 0);
      });

      const part1 = priorityPartners.slice(0, assignedIndex + 1);
      const part2 = priorityPartners.slice(assignedIndex + 1);
      return part2.concat(part1);
    }

    const sortedPrioritizedPartners = [...prioritizedPartners].sort((a, b) => {
      const idxA = indexMap.has(a.id) ? indexMap.get(a.id) : 9999;
      const idxB = indexMap.has(b.id) ? indexMap.get(b.id) : 9999;
      return idxA - idxB;
    });

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
    console.error("Sorting error", error); 
    return prioritizedPartners;
  }
}