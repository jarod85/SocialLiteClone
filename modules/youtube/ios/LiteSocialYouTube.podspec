Pod::Spec.new do |s|
  s.name           = 'LiteSocialYouTube'
  s.version        = '1.0.0'
  s.summary        = 'Lite Social YouTube: the iOS side (player quality cap, downloads).'
  s.author         = 'Lite Social'
  s.homepage       = 'https://github.com/jarod85/SocialLiteClone'
  s.license        = 'MIT'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
