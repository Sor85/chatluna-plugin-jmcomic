declare module 'archiver-zip-encrypted' {
  const encryptedZip: Parameters<typeof import('archiver').registerFormat>[1]
  export default encryptedZip
}
