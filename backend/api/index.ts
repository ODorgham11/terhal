import { getRequestListener } from '@hono/node-server'
import app from '../src/app.js'

// Vercel's Node.js runtime calls this with Node's (req, res) objects.
// getRequestListener converts them into the Web Request/Response that Hono
// uses. (Don't use `hono/vercel` here: that adapter is for the Edge runtime
// and never writes the response on Node, so requests hang until timeout.)
export const config = {
  api: { bodyParser: false },
}

export default getRequestListener(app.fetch)