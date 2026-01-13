import fp from 'fastify-plugin';

export default fp(async function (fastify, opts) {
  fastify.decorate('authenticate', async function (request, reply) {
    try {
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        throw new Error('No token provided');
      }

      const token = authHeader.split('Bearer ')[1];

      // Use fastify.firebase instead of direct import
      const decodedToken = await fastify.firebase.admin.auth().verifyIdToken(token);
      request.user = decodedToken; 
    } catch (err) {
      reply.code(401).send({ message: 'Unauthorized', error: err.message });
    }
  });
});