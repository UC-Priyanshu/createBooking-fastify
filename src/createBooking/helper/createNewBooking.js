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

async function createNewBooking(
  fastify,
  bookingData,
  preferredPartner,
  bookingDate
) {


  try {
    /* -------- SLOT MAP -------- */
    const slotMapStart = process.hrtime.bigint();
    const slotMapAndStatus = await getSlotMapAndStatus(
      bookingData,
      preferredPartner,
      bookingDate
    );
    const slotMapEnd = process.hrtime.bigint();
    const slotMapDuration = Number(slotMapEnd - slotMapStart) / 1_000_000;
    console.log(`  [STEP 1] getSlotMapAndStatus: ${slotMapDuration.toFixed(2)}ms`);

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
    const assignPartnerStart = process.hrtime.bigint();
    
    const userRef = fastify.firebase.firestore.collection("users").doc(bookingData.clientid);
    const userDocPromise = userRef.get();
    
    const finalBookingStatus = await recheckAndAssignPartnerToBooking(
      fastify,
      slotMapAndStatus.slotMap,
      bookingData,
      bookingDate,
      preferredPartner
    );
    const assignPartnerEnd = process.hrtime.bigint();
    const assignPartnerDuration = Number(assignPartnerEnd - assignPartnerStart) / 1_000_000;
    console.log(`  [STEP 2] recheckAndAssignPartnerToBooking: ${assignPartnerDuration.toFixed(2)}ms`);

    if (
      finalBookingStatus.statusCode === 200 &&
      finalBookingStatus.status === "Placed"
    ) {
      try {
        const walletUpdateStart = process.hrtime.bigint();
        const userDoc = await userDocPromise;
        const userDocTime = Number(process.hrtime.bigint() - walletUpdateStart) / 1_000_000;
        console.log(`  [DB] Fetch user document: ${userDocTime.toFixed(2)}ms (pre-fetched)`);
        
        if (!userDoc.exists) return finalBookingStatus;
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
        const updateStart = process.hrtime.bigint();
        await userRef.update(updateData);
        const updateTime = Number(process.hrtime.bigint() - updateStart) / 1_000_000;
        const totalWalletTime = Number(process.hrtime.bigint() - walletUpdateStart) / 1_000_000;
        console.log(`  [DB] Update user wallet: ${updateTime.toFixed(2)}ms`);
        console.log(`  [STEP 3] Total wallet update: ${totalWalletTime.toFixed(2)}ms`);
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
    const prioritizeStart = process.hrtime.bigint();
    const prioritizedPartners = await prioritizePartners(
      fastify,
      slotMap.availablePartners,
      coordinates,
      bookingDate
    );
    const prioritizeEnd = process.hrtime.bigint();
    const prioritizeDuration = Number(prioritizeEnd - prioritizeStart) / 1_000_000;
    console.log(`    [SUB-STEP 2.1] prioritizePartners: ${prioritizeDuration.toFixed(2)}ms`);

    const recheckStart = process.hrtime.bigint();
    const availability = await recheckAvailabilityOfPartner(
      fastify,
      slotMap["slot no."],
      prioritizedPartners,
      bookingDate,
      bookingData
    );
    const recheckEnd = process.hrtime.bigint();
    const recheckDuration = Number(recheckEnd - recheckStart) / 1_000_000;
    console.log(`    [SUB-STEP 2.2] recheckAvailabilityOfPartner: ${recheckDuration.toFixed(2)}ms`);


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

    const assignStart = process.hrtime.bigint();
    const bookingStatus = await assignBookingToPartner(
      fastify,
      bookingData,
      preferredPartner,
      availability,
      bookingDate
    );
    const assignEnd = process.hrtime.bigint();
    const assignDuration = Number(assignEnd - assignStart) / 1_000_000;
    console.log(`    [SUB-STEP 2.3] assignBookingToPartner: ${assignDuration.toFixed(2)}ms`);
    if (bookingStatus?.statusCode !== 200) {
      return {
        statusCode: 400,
        status: "Unknown",
        message: "Failed to assign partner",
      };
    }

    const timingUpdateStart = process.hrtime.bigint();
    const timingUpdate = await changeTimingOfPartners(
      fastify,
      bookingData,
      availability,
      bookingDate,
      bookingStatus.bookingId
    );
    const timingUpdateEnd = process.hrtime.bigint();
    const timingUpdateDuration = Number(timingUpdateEnd - timingUpdateStart) / 1_000_000;
    console.log(`    [SUB-STEP 2.4] changeTimingOfPartners: ${timingUpdateDuration.toFixed(2)}ms`);

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
      message: "Booking is successfully placed and assigned to a partner.",
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
