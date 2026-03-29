module.exports = {
  packagerConfig: {
    asar: true,
    asarUnpack: [
      'node_modules/sql.js/dist/**'
    ],
    prune: true,
    extraResource: ['resources']
  },
  makers: [
    { name: '@electron-forge/maker-zip', platforms: ['win32'] }
  ]
}