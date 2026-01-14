import Fastify from 'fastify';
import configPlugin from './plugin/config.js';
import firebasePlugin from './plugin/firebase.js';
import { createBookingRoutes } from './createBooking/create_booking.route.js';

export async function buildApp(options = {}) {

    const app = Fastify({
        logger: {
            level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
        },
        connectionTimeout: 30000,
        keepAliveTimeout: 30000,
        requestIdLogLabel: 'reqId'    });

    // Register plugins in order
    app.register(configPlugin);
    app.register(firebasePlugin);

    // Register routes
    app.register(createBookingRoutes);

    app.setNotFoundHandler((request, reply) => {
        reply.code(404).send({
            success: false,
            error: 'Not Found',
            message: `Route ${request.method}:${request.url} not found`,
        });
    });

    return app;
}
