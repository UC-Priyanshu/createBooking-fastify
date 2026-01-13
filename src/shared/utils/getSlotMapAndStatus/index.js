// import logger from "../logger.js";

async function getSlotMapAndStatus(
    bodydetails,
    preferredPartner,
    bookingDate,
    rescheduleData
) {
    // logger.info({
    //     line: 7,
    //     bodydetails,
    //     preferredPartner,
    //     bookingDate,
    //     rescheduleData,
    // });
    try {
        // Call Slot API to prepare The SlotMap Object Data.
        const preferredPartnerId =
            preferredPartner === "none" ? "" : preferredPartner.trim();

        const bodyFoSlotAPI = {
            newBookingCoordinates: {
                latitude: bodydetails.latitude,
                longitude: bodydetails.longitude,
            },
            priceToPay: bodydetails.priceToPay,
            pickedDate: [`${bookingDate}`],
            clientId: `${bodydetails.clientid}`,
            rescheduling: {
                status: rescheduleData ? rescheduleData.status : false,
                bookingId: rescheduleData ? rescheduleData.bookingId : "",
                role: "admin",
            },
            serviceMinutes: bodydetails.bookingsminutes,
            preferredPartner: preferredPartnerId,
        };
        const slotAPIData = await fetchSlotAPIData(bodyFoSlotAPI);
        // logger.info({line: 33, slotAPIData});

        if (slotAPIData.error) {
            return {
                statusCode: 401,
                error: slotAPIData.error || "Error occured in fetching slot data.",
            };
        }

        if (slotAPIData.datesMap.length !== 0) {
            // logger.info({line: 45, rescheduleData});
            const slotMap = prepareSlotMap(
                slotAPIData,
                bookingDate,
                rescheduleData && rescheduleData.status
                    ? rescheduleData.rescheduleSlotNumber
                    : bodydetails.slotnumber
            );

            // logger.info({line: 55, slotMap});
            // logger.info({line: 56, availablePartners: (slotMap?.availablePartners || "undefined")});
            return {
                statusCode: 200,
                slotMap: slotMap,
                bookingstatus: "pending",
            };
        }

        if (slotAPIData.datesMap.length === 0 && preferredPartnerId !== "") {
            return {
                statusCode: 201,
                message:
                    "Requested partner is unavailable at the moment. Please select another partner.",
                bookingstatus: "dead(NOR)",
            };
        }
        return {
            statusCode: 201,
            message:
                "Due to high demand, your booking can not be placed at the moment. Please try again later.",
            bookingstatus: "dead(NOR)",
        };
    } catch (error) {
        // logger.info({line: 75, error});
        return {
            statusCode: 500,
            error: error.message || "Internal Server Error.",
        };
    }
}

async function fetchSlotAPIData(bodyFoSlotAPI) {
    // logger.info({line: 89, bodyFoSlotAPI});
    const response = await fetch(
        "https://asia-south1-urbanculture5.cloudfunctions.net/availabilityOfSlots",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(bodyFoSlotAPI),
        }
    );
    if (!response.ok) {
        return {
            error: response.statusText,
            statusText: response.status,
            status: 401,
        };
    }
    const data = await response.json();
    return data;
}

function prepareSlotMap(slotAPIData, bookingDate, slotNumber) {
    // logger.info({line: 104, bookingDate, slotNumber});
    const choosedDateMap = slotAPIData.datesMap.filter((dateMap) => {
        return dateMap.dateId === bookingDate.replace(/-/g, "");
    });

    const slotMap = choosedDateMap[0].slots.filter((slot) => {
        return slot["slot no."] === slotNumber;
    });
    return slotMap[0];
}

export default getSlotMapAndStatus;
