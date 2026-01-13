function calculateBookedSlots(bookingMinutes, slotNumber) {
    // Calculate the number of slots needed, rounding up
    const numberOfSlots = Math.ceil(bookingMinutes / 30);

    // Initialize the list of booked slots
    const listOfBookedSlots = [];
    // Fill the list with slot numbers
    for (let i = 0; i < numberOfSlots; i++) {
        listOfBookedSlots.push(slotNumber + i);
    }

    return listOfBookedSlots;
}

export {calculateBookedSlots};
