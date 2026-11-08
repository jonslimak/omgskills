-- Cloud save: a skill added from GitHub keeps its SKILL.md description, so My skills can show it before any
-- Mac has it installed (a Mac's own report gives the description otherwise). Null for every other save.
ALTER TABLE cloud_saved_skills ADD COLUMN skill_description text;
