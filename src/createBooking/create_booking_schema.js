const bodySchema = {
  type: 'object',
  required: ['preferredPartner', 'bookingDate'],
  properties: {
    preferredPartner: { type: 'string', minLength: 1 },
    bookingDate: { type: 'string', format: 'date' }, // Validates YYYY-MM-DD format automatically
    rescheduleData: {
      type: 'object',
      properties: {
        status: { type: 'boolean' },
        bookingId: { type: 'string' },
        rescheduleSlotNumber: { type: 'integer', minimum: 0, maximum: 23 }
      }
    },
    bookingData: {
      type: 'object',
      properties: {
        bookingsminutes: { type: 'integer' },
        priceToPay: { type: 'number' },
        clientid: { type: 'string' },
        latitude: { type: 'number' },
        longitude: { type: 'number' }
      }
    }
  }
};

export const createBookingSchema = {
  body: bodySchema
};