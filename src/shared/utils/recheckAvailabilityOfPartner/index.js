import { firestore } from "../../../plugin/firebase.js";
// import logger from "../logger.js";

async function recheckAvailabilityOfPartner(
    slotNo,
    prioritizedPartners,
    bookingDate,
    bookingData,
    rescheduleData
) {
    // logger.info({line: 10, msg: "recheckAvailabilityOfPartner"});
    try {
        const convertedDateString = bookingDate.replace(/-/g, "");
        let statusOfAvailability = false;
        let availablePartnerwithHighestPriority = null;
        let partnerMissedLeadReasonListOfMap = [];
        for (const partner of prioritizedPartners) {
            // logger.info({line: 17, partnerId: partner.id});

            const docRef = firestore
                .collection("partner")
                .doc(partner.id)
                .collection("timings")
                .doc(convertedDateString);

            const snapshot = await docRef.get();

            // logger.info({line: 22, partner});

            if (snapshot.exists) {
                const data = snapshot.data();
                // logger.info({
                //     line: 27,
                //     leave: data.leave,
                //     available: data.available,
                //     booked: data.booked,
                //     nonWorkingSlots: data.nonWorkingSlots,
                //     partner: partner.id,
                // });
                if (
                    rescheduleData &&
                    rescheduleData.status === true &&
                    bookingData.listofbookedslots.some((slot) =>
                        data.leave.includes(slot)
                    ) &&
                    data.leave.includes(slotNo)
                ) {
                    // logger.info({rescheduleData});

                    /// check that is it missed lead or not
                    partnerMissedLeadReasonListOfMap.push({
                        partner: partner.id,
                        reason: "Partner is on leave",
                    });
                    // logger.info({
                    //     line: 54,
                    //     msg: "partner is on leave",
                    //     partner: partner.id,
                    // });


                    continue;
                } else if (data.available.includes(slotNo)) {
                    statusOfAvailability = true;
                    availablePartnerwithHighestPriority = partner;
                } else if (
                    data.booked.includes(slotNo) &&
                    rescheduleData != undefined &&
                    rescheduleData.status === true &&
                    bookingData.listofbookedslots.includes(slotNo)
                ) {
                    statusOfAvailability = true;
                    availablePartnerwithHighestPriority = partner;
                } else {
                    statusOfAvailability = false;
                    availablePartnerwithHighestPriority = null;


                    /// check that is it missed lead or not

                    if (
                        data.nonWorkingSlots.includes(slotNo)) {
                        // logger.info({
                        //     line: 74,
                        //     msg: "partner is not available Due to Non working slots",
                        //     partner: partner.id,
                        // });
                        partnerMissedLeadReasonListOfMap.push({
                            partner: partner.id,
                            reason: "Partner is not available Due to Non working slots",
                        });
                    } else if (data.leave.includes(slotNo)) {
                        // logger.info({
                        //     line: 78,
                        //     msg: "partner is on leave",
                        //     partner: partner.id,
                        // });
                        partnerMissedLeadReasonListOfMap.push({
                            partner: partner.id,
                            reason: "Partner is on leave",
                        });
                    }


                    continue;
                }
            } else {
                logger.info({line: 60, msg: "partner timing doc does not exist"});
                statusOfAvailability = true;
                availablePartnerwithHighestPriority = partner;
            }
            if (statusOfAvailability) {
                return {
                    partner: availablePartnerwithHighestPriority,
                    availablityStatus: true,
                    partnerMissedLeadReasonListOfMap
                };
            }
            if (rescheduleData && rescheduleData.status === false) {
                return {
                    availablityStatus: false,
                    message:
                        "Due to high demand and unavailability of Beuticians, we can not place your booking. Please try again later",
                    partnerMissedLeadReasonListOfMap
                };
            }
            bookingData.status = "dead";
            return {
                availablityStatus: false,
                message:
                    "Due to high demand and unavailability of Beuticians, we can not place your booking. Please try again later!",
                partnerMissedLeadReasonListOfMap
            };
        }
        return {
            statusCode: 400,
            message: "All Partner is on leave.",
            availablityStatus: false,
            partnerMissedLeadReasonListOfMap
        };
    } catch (error) {
        // logger.info({line: 78, error});
        return {
            statusCode: 404,
            message:
                "Due to some technical issue, we can not place your booking. Please try again later!",
            availablityStatus: false,
        };
    }
    // logger.info({
    //   line: 9,
    //   slotNo,
    //   prioritizedPartners,
    //   bookingDate,
    //   bookingData,
    // });
}

export default recheckAvailabilityOfPartner;
