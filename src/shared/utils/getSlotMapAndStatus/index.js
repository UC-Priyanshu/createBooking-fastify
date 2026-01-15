const SLOT_API_URL =
  "https://asia-south1-urbanculture5.cloudfunctions.net/availabilityOfSlots";

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

async function fetchSlotAPIData(body) {
//   const controller = new AbortController();
//   const timeout = setTimeout(() => controller.abort(), 3500);

  const startTime = process.hrtime.bigint();
  console.log(`    [EXTERNAL API] Slot API request started at: ${new Date().toISOString()}`);

  try {
    const response = await fetch(SLOT_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    //   signal: controller.signal,
    });

    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - startTime) / 1_000_000;
    console.log(`    [EXTERNAL API] Slot API response received in: ${duration.toFixed(2)}ms (${(duration / 1000).toFixed(2)}s)`);

    if (!response.ok) {
      return {
        error: response.statusText,
        status: response.status,
      };
    }

    const jsonData = await response.json();
    const totalTime = Number(process.hrtime.bigint() - startTime) / 1_000_000;
    console.log(`    [EXTERNAL API] Total time (including JSON parsing): ${totalTime.toFixed(2)}ms (${(totalTime / 1000).toFixed(2)}s)`);
    
    return jsonData;
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
