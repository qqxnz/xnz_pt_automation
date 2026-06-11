import { makeStandardNexusPhpSignin } from './standardNexusPhp.js'

export const keepfrdsSignin = makeStandardNexusPhpSignin({
  matchDomains: ['pt.keepfrds.com', 'keepfrds.com']
})
