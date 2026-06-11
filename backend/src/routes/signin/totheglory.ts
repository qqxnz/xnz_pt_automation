import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const totheglorySignin = makeStandardNexusPhpSignin({
  matchDomains: ['totheglory.im', 'www.totheglory.im']
})
