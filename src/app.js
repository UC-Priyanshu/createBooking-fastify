import Fastify from 'fastify';
import configPlugin from './plugin/config.js';
import firebasePlugin from './plugin/firebase.js';
import authPlugin from './plugin/auth.js';
import { createBookingRoutes } from './createBooking/create_booking.route.js';

export async function buildApp(options = {}) {

    const app = Fastify({
        logger: true,
        connectionTimeout: 120000,
        keepAliveTimeout: 120000,
        requestIdLogLabel: 'reqId',
        disableRequestLogging: process.env.NODE_ENV === 'production',
    });

    // Register plugins in order
    await app.register(configPlugin);
    await app.register(firebasePlugin);
    await app.register(authPlugin);



    // Register routes
    await app.register(createBookingRoutes);

    // Health check endpoint
    app.get('/health', async (request, reply) => {
        return { success: true, status: 'ok', timestamp: Date.now() };
    });

    app.setNotFoundHandler((request, reply) => {
        reply.code(404).send({
            success: false,
            error: 'Not Found',
            message: `Route ${request.method}:${request.url} not found`,
        });
    });

    return app;
}
