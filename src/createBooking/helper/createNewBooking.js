import getSlotMapAndStatus from "../../shared/utils/getSlotMapAndStatus/index.js";
import prioritizePartners from "../../shared/utils/prioritizePartners/index.js";
import recheckAvailabilityOfPartner from "../../shared/utils/recheckAvailabilityOfPartner/index.js";
import { assignBookingToPartner } from "./assignBookingToPartner.js";
import { changeTimingOfPartners } from "./changeTimingOfPartners.js";
import { pushDeadBookingToDatabase } from "./pushDeadBookingToDatabase.js";
import {
  initMissedLeads,
} from "../../shared/utils/missed_lead/missed_lead_helper_for_create_booking.js";
import { removeUsersFromAudience } from "../../shared/utils/audiences_helper.js";


const PURCHASE_CANCELLED_AUDIENCE_ID =
  process.env.PURCHASE_CANCELLED_AUDIENCE_ID;

/* ---------------- MAIN FUNCTION ---------------- */
async function createNewBooking(
  fastify,
  bookingData,
  preferredPartner,
  bookingDate
) {


  try {
    /* -------- SLOT MAP -------- */
    const slotMapAndStatus = await getSlotMapAndStatus(
      bookingData,
      preferredPartner,
      bookingDate
    );

    if (slotMapAndStatus.statusCode !== 200) {
      if (slotMapAndStatus.statusCode === 201) {
        const dead = await pushDeadBookingToDatabase(bookingData);
        if (dead.statusCode === 200) {
          return {
            statusCode: 200,
            status: "Dead",
            message:
              "Due to high demand, your booking cannot be placed right now.",
          };
        }
      }

      return {
        statusCode: 400,
        status: "Unknown",
        message: "Slot map generation failed",
      };
    }

    /* -------- ASSIGN PARTNER -------- */
    const finalBookingStatus = await recheckAndAssignPartnerToBooking(
      fastify,
      slotMapAndStatus.slotMap,
      bookingData,
      bookingDate,
      preferredPartner
    );

    if (
      finalBookingStatus.statusCode === 200 &&
      finalBookingStatus.status === "Placed"
    ) {
      // updateWallet(fastify, bookingData).catch(() => { });
      try {
        const userRef = fastify.firebase.firestore.collection("users").doc(bookingData.clientid);
        const userDoc = await userRef.get();
        if (!userDoc.exists) return;
        const userData = userDoc.data();
        // await removeUsersFromAudience(PURCHASE_CANCELLED_AUDIENCE_ID, [userData]);

        let newBalance = Math.max(
          0,
          userData.payment.balance - bookingData.walletMoney
        );

        const updateData = {
          payment: { balance: newBalance },
        };

        if (bookingData.couponId) {
          updateData.couponIds = fastify.firebase.FieldValue.arrayRemove(bookingData.couponId);
        }
        await userRef.update(updateData);
      } catch (error) {
        return {
          statusCode: 400,
          status: "Unknown",
          message: "Error in updating wallet",
          error: error.message,
        }
      }
    }
    return finalBookingStatus;
  } catch (error) {
    return {
      statusCode: 400,
      status: "Unknown",
      message: "Error in creating booking",
    };
  }
}


/* ---------------- ASSIGN PARTNER ---------------- */
async function recheckAndAssignPartnerToBooking(
  fastify,
  slotMap,
  bookingData,
  bookingDate,
  preferredPartner
) {
  try {
    const coordinates = {
      latitude: bookingData.latitude,
      longitude: bookingData.longitude,
    };
    const prioritizedPartners = await prioritizePartners(
      fastify,
      slotMap.availablePartners,
      coordinates,
      bookingDate
    );

    const availability = await recheckAvailabilityOfPartner(
      fastify,
      slotMap["slot no."],
      prioritizedPartners,
      bookingDate,
      bookingData
    );


    if (!availability.availablityStatus) {
      const dead = await pushDeadBookingToDatabase(bookingData);
      return dead.statusCode === 200
        ? {
          statusCode: 200,
          status: "Dead",
          message:
            "Due to high demand, booking could not be placed.",
        }
        : {
          statusCode: 400,
          status: "Unknown",
          message: "Booking failed",
        };
    }

    const bookingStatus = await assignBookingToPartner(
      fastify,
      bookingData,
      preferredPartner,
      availability,
      bookingDate
    );
    if (bookingStatus?.statusCode !== 200) {
      return {
        statusCode: 400,
        status: "Unknown",
        message: "Failed to assign partner",
      };
    }

    const timingUpdate = await changeTimingOfPartners(
      fastify,
      bookingData,
      availability,
      bookingDate,
      bookingStatus.bookingId
    );

    if (timingUpdate?.statusCode !== 200) {
      return {
        statusCode: 400,
        status: "Unknown",
        message: "Failed to update timings",
        bookingId: bookingStatus.bookingId,
      };
    }

    if (preferredPartner === "none") {
      initMissedLeads(
        fastify,
        availability.partnerMissedLeadReasonListOfMap,
        bookingData,
        bookingDate
      ).catch(() => { });
    }

    return {
      statusCode: 200,
      status: "Placed",
      message: "Booking successfully placed",
      bookingId: bookingStatus.bookingId,
    };
  } catch (error) {
    return {
      statusCode: 400,
      status: "Unknown",
      message: "Error assigning partner",
    };
  }
}

export { createNewBooking };
