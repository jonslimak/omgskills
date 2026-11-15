-- The Mac app's build (CFBundleVersion), from its X-OMGSkills-App-Build header, so the website offers only what it can do.
ALTER TABLE device_tokens ADD COLUMN app_build integer CONSTRAINT device_tokens_app_build_check CHECK (app_build > 0);
