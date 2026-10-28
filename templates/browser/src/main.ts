import './styles/base.css';
import { bootstrapApplication } from '@xiaobaibaifqy/jingchuanchu-app/application';
import { AppConfig } from './app/app-config.js';
import { bindAudioPreferences } from './app/audio-preferences.js';
void bootstrapApplication(AppConfig)
  .then((app) => {
    bindAudioPreferences(app.root.exposed.preferences, app.audio, app.root.owner.scope);
  })
  .catch((error) => console.error(error));
