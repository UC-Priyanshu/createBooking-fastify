const SLOT_API_URL =
  "https://asia-south1-urbanculture5.cloudfunctions.net/availabilityOfSlots";

/* ---------------- MAIN FUNCTION ---------------- */
async function getSlotMapAndStatus(
  bodydetails,
  preferredPartner,
  bookingDate,
  rescheduleData
) {
  const preferredPartnerId =
    preferredPartner === "none" ? "" : preferredPartner.trim();

  const bodyForSlotAPI = {
    newBookingCoordinates: {
      latitude: bodydetails.latitude,
      longitude: bodydetails.longitude,
    },
    priceToPay: bodydetails.priceToPay,
    pickedDate: [bookingDate],
    clientId: bodydetails.clientid,
    rescheduling: {
      status: Boolean(rescheduleData?.status),
      bookingId: rescheduleData?.bookingId ?? "",
      role: "admin",
    },
    serviceMinutes: bodydetails.bookingsminutes,
    preferredPartner: preferredPartnerId,
  };

  const slotAPIData = await fetchSlotAPIData(bodyForSlotAPI);

  if (!slotAPIData || slotAPIData.error) {
    return {
      statusCode: 401,
      error: slotAPIData?.error ?? "Error fetching slot data",
    };
  }

  if (!Array.isArray(slotAPIData.datesMap) || slotAPIData.datesMap.length === 0) {
    return {
      statusCode: 201,
      message:
        preferredPartnerId !== ""
          ? "Requested partner is unavailable at the moment."
          : "Due to high demand, booking cannot be placed.",
      bookingstatus: "dead(NOR)",
    };
  }

  const slotMap = prepareSlotMap(
    slotAPIData,
    bookingDate,
    rescheduleData?.status
      ? rescheduleData.rescheduleSlotNumber
      : bodydetails.slotnumber
  );

  if (!slotMap) {
    return {
      statusCode: 201,
      message: "Requested slot is unavailable.",
      bookingstatus: "dead(NOR)",
    };
  }

  return {
    statusCode: 200,
    slotMap,
    bookingstatus: "pending",
  };
}

/* ---------------- FETCH WITH TIMEOUT ---------------- */
async function fetchSlotAPIData(body) {
//   const controller = new AbortController();
//   const timeout = setTimeout(() => controller.abort(), 3500);

  try {
    const response = await fetch(SLOT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    //   signal: controller.signal,
    });

    if (!response.ok) {
      return {
        error: response.statusText,
        status: response.status,
      };
    }

    return await response.json();
  } catch (err) {
    return {
      error:
        err.name === "AbortError"
          ? "Slot service timeout"
          : err.message,
    };
  } 
//   finally {
//     // clearTimeout(timeout);
//   }
}

/* ---------------- FAST SLOT MAP PREPARATION ---------------- */
function prepareSlotMap(slotAPIData, bookingDate, slotNumber) {
  const dateId = bookingDate.replace(/-/g, "");

  const dateMap = slotAPIData.datesMap.find(
    (d) => d.dateId === dateId
  );
  if (!dateMap) return null;

  return dateMap.slots.find(
    (slot) => slot["slot no."] === slotNumber
  ) ?? null;
}

export default getSlotMapAndStatus;
