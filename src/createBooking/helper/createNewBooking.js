import getSlotMapAndStatus from '../../shared/utils/getSlotMapAndStatus/index.js';
import prioritizePartners from '../../shared/utils/prioritizePartners/index.js';
import recheckAvailabilityOfPartner from '../../shared/utils/recheckAvailabilityOfPartner/index.js';
import { assignBookingToPartner } from './assignBookingToPartner.js';
import { changeTimingOfPartners } from './changeTimingOfPartners.js';
import { pushDeadBookingToDatabase } from './pushDeadBookingToDatabase.js';
import { initMissedLeads } from '../../shared/utils/missed_lead/missed_lead_helper_for_create_booking.js';
import { removeUsersFromAudience } from '../../shared/utils/audiences_helper.js';
import { calculateBookedSlots } from '../../shared/utils/calculateBookedSlots.js';

const PURCHASE_CANCELLED_AUDIENCE_ID = process.env.PURCHASE_CANCELLED_AUDIENCE_ID;

/**
 * Main Service: Create New Booking
 * Optimized for maximum speed - minimal logging
 */
export default async function createNewBooking(fastify, bookingData, preferredPartner, bookingDate, reply) {
  try {
    // Access Firebase through fastify
    const { firestore, FieldValue } = fastify.firebase;

    // 1. Get Slot Map
    const slotMapAndStatus = await getSlotMapAndStatus(bookingData, preferredPartner, bookingDate);
    console.log("Slot Map and Status:", slotMapAndStatus);

    // LOGIC BRANCH 1: Slots Found (200)
    if (slotMapAndStatus.statusCode === 200) {
      const finalBookingStatus = await recheckAndAssignPartnerToBooking(
        fastify,
        slotMapAndStatus.slotMap,
        bookingData,
        bookingDate,
        preferredPartner
      );
      console.log("Final Booking Status after Recheck and Assign:", finalBookingStatus);
      // Success Flow
      if (finalBookingStatus.statusCode === 200 && finalBookingStatus.status === "Placed") {

        // Update Wallet (Critical Operation - keep awaited)
        // await updateWallet(fastify, bookingData).catch(() => { });

        return reply.code(200).send({
          statusCode: 200,
          status: "Placed",
          message: finalBookingStatus.message,
          bookingId: finalBookingStatus.bookingId,
        });
      }

      // Failure Flow (Logic returned error)
      return reply.code(400).send({
        statusCode: 400,
        status: finalBookingStatus.status || "Unknown",
        message: finalBookingStatus.message || "Unknown Error Occurs.",
        bookingId: finalBookingStatus.bookingId || "",
      });
    }

    // LOGIC BRANCH 2: Slots Full / Dead Booking (201)
    if (slotMapAndStatus.statusCode === 201) {
      const bookingStatus = await pushDeadBookingToDatabase(fastify, bookingData);

      if (bookingStatus.statusCode === 200) {
        return reply.code(200).send({
          statusCode: 200,
          status: "Dead",
          message: getSlotMapAndStatus.message || "Due to high demand, your booking can not be placed at the moment.",
        });
      }

      return reply.code(400).send({
        statusCode: 400,
        status: "Unknown",
        message: "Error processing Dead Booking.",
      });
    }

    // Default Error Fallback
    return reply.code(400).send({
      statusCode: 400,
      status: "Unknown",
      message: "Unknown Error Occurs in getting Slot Map.",
    });

  } catch (error) {
    // Only log in non-production for debugging
    if (process.env.NODE_ENV !== 'production') {
      console.error('createNewBooking error:', error);
    }
    return reply.code(400).send({
      statusCode: 400,
      status: "Unknown",
      message: "Unknown Error Occurs in creating New Booking.",
    });
  }
}

export { createNewBooking };

// ------------------------------------------------------------------
// HELPER: Recheck & Assign (The Heavy Lifter)
// ------------------------------------------------------------------
async function recheckAndAssignPartnerToBooking(fastify, slotMap, bookingData, bookingDate, preferredPartner) {
  try {
    const coordinates = {
      latitude: bookingData.latitude,
      longitude: bookingData.longitude,
    };
    console.log("Coordinates:", coordinates);

    // Step 1: Prioritize
    const prioritizedPartners = await prioritizePartners(
      // fastify,
      slotMap.availablePartners,
      coordinates,
      bookingDate
    );
    console.log("Prioritized Partners:", prioritizedPartners);

    // Step 2: Recheck Availability
    const recheckResponse = await recheckAvailabilityOfPartner(
      // fastify,
      slotMap["slot no."],
      prioritizedPartners,
      bookingDate,
      bookingData
    );
    console.log("Recheck Response:", recheckResponse);

    // LOGIC: Partner Available?
    if (recheckResponse.availablityStatus) {

      // A. Assign Partner
      const bookingStatus = await assignBookingToPartner(
        // fastify,
        bookingData,
        preferredPartner,
        recheckResponse,
        bookingDate
      );
      console.log("Booking Status after assignment:", bookingStatus);

      if (bookingStatus?.statusCode === 200) {

        // B. Change Timings
        const changeTimingsResponse = await changeTimingOfPartners(
          // fastify,
          bookingData,
          recheckResponse,
          bookingDate,
          bookingStatus.bookingId
        );

        if (changeTimingsResponse?.statusCode === 200) {

          // D. Missed Leads (If 'none' preferred) - Fire and forget
          if (preferredPartner === "none") {
            initMissedLeads(
              fastify,
              recheckResponse.partnerMissedLeadReasonListOfMap,
              bookingData,
              bookingDate
            ).catch(() => { });
          }

          return {
            statusCode: 200,
            status: "Placed",
            message: "Booking is successfully placed and assigned to a partner.",
            bookingId: bookingStatus.bookingId,
          };
        }

        // Timing Change Failed
        return {
          statusCode: 400,
          status: "Unknown",
          message: "Error occurs in changing the timing of partners. from here",
          bookingId: bookingStatus.bookingId ?? "",
        };
      }

      // Assignment Failed
      return {
        statusCode: 400,
        status: "Unknown",
        message: "Error in placing Booking and assigning to a partner.",
        bookingId: bookingStatus.bookingId ?? "",
      };
    }

    // LOGIC: No Partner Available -> Dead Booking
    const deadBookingStatus = await pushDeadBookingToDatabase(fastify, bookingData);
    if (deadBookingStatus.statusCode === 200) {
      return {
        statusCode: 200,
        status: "Dead",
        message: "Due to high demand and unavailability of Beauticians, we can not place your booking.",
      };
    }

    return {
      statusCode: 400,
      status: "Unknown",
      message: "Error occurs in rechecking (Dead Booking Failed).",
    };

  } catch (error) {
    // Silent failure for speed
    return {
      statusCode: 400,
      status: "Unknown",
      message: "Error occurs in rechecking and Assigning Partner. from here.",
    };
  }
}

// ------------------------------------------------------------------
// HELPER: Wallet Update (Critical - uses transaction for safety)
// ------------------------------------------------------------------
async function updateWallet(fastify, bookingData) {
  const { firestore, FieldValue } = fastify.firebase;
  const PURCHASE_CANCELLED_AUDIENCE_ID = process.env.PURCHASE_CANCELLED_AUDIENCE_ID;

  try {
    const userDocRef = firestore.collection("users").doc(bookingData.clientid);

    // Use transaction to prevent race conditions
    await firestore.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userDocRef);

      if (!userDoc.exists) throw new Error("User not found for wallet update");

      const userData = userDoc.data();
      const currentBalance = userData.payment?.balance || 0;

      // Prevent negative balance (safety check)
      if (currentBalance < bookingData.walletMoney) {
        throw new Error("Insufficient wallet balance");
      }

      const newBalance = currentBalance - bookingData.walletMoney;

      const updatePayload = {
        'payment.balance': newBalance
      };

      if (bookingData.couponId) {
        updatePayload.couponIds = FieldValue.arrayRemove(bookingData.couponId);
      }

      transaction.update(userDocRef, updatePayload);

      // Fire and forget audience update
      removeUsersFromAudience(fastify, PURCHASE_CANCELLED_AUDIENCE_ID, [userData]).catch(() => { });
    });

  } catch (error) {
    // Don't throw - booking should succeed even if wallet update fails
    // Log only in development
    if (process.env.NODE_ENV !== 'production') {
      console.error('Wallet update error:', error.message);
    }
  }
}

