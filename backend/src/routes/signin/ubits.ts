import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const ubitsSignin = makeStandardNexusPhpSignin({
  matchDomains: ['ubits.club', 'www.ubits.club']
})
