fx_version 'cerulean'
game 'gta5'

name 'obey-feed'
description 'Obey RP — pushes IC events + per-event metrics to obey-bridge'
author 'Obey RP'
version '1.0.0'

server_scripts {
  'config.lua',
  'sha256.lua',
  'server.lua',
}

server_exports {
  'pushEvent',
  'logMetric',
}
