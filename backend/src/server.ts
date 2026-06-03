import { app } from './app.js'

const port = Number(process.env.PORT ?? 3180)

app.listen(port, () => {
  console.log(`PT Automation API listening on http://localhost:${port}`)
})
