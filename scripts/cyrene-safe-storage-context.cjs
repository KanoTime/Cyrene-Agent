const CYRENE_SAFE_STORAGE_APP_NAME = "live2d-cyrene";

function configureCyreneSafeStorageContext(app) {
  app.setName(CYRENE_SAFE_STORAGE_APP_NAME);
}

module.exports = {
  CYRENE_SAFE_STORAGE_APP_NAME,
  configureCyreneSafeStorageContext,
};
