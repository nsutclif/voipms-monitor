'use strict';

// Lambda doesn't contain either aws cli or zip command
// This was the easiest workaround I could find...

const gulp = require('gulp');
const zip = require('gulp-zip');
const s3 = require('gulp-s3-upload')();
const modifyFile = require('gulp-modify-file');
const yaml = require('js-yaml');

const BUCKET_NAME = 'lambci-buildresults-ga8wy7gvebrx'; // TODO: Don't hard-code this!
const CODE_KEY_NAME = 'packaged.zip';

function prependKeyPrefix(relative_filename) {
  return [ // TODO: Don't hard code this?
    'gh',
    process.env.LAMBCI_REPO,
    'builds',
    process.env.LAMBCI_BUILD_NUM,
    relative_filename
  ].join('/');
}

function updateArtifactPaths(content, path, file) {
  const template = yaml.safeLoad(content);

  const functionResources = Object.keys(template.Resources).filter((key) => {
    return template.Resources[key].Type === "AWS::Serverless::Function";
  }).map((key) => {
    return template.Resources[key];
  });

  if (!functionResources.length) {
    throw new Error("No function resources found!");
  }

  if (functionResources.length > 1) {
    throw new Error("Build processes assumes only one function resource.");
  }

  functionResources[0].Properties.CodeUri = 
    "s3://" + BUCKET_NAME + '/' + prependKeyPrefix(CODE_KEY_NAME);

  // We could convert this to JSON, but it's probably easier for debugging to just leave it as YAML
  return yaml.safeDump(template);
}

gulp.task('package', () =>
  {
    gulp.src('packaged/**/*')
      .pipe(zip(CODE_KEY_NAME))
      .pipe(s3({
        Bucket: BUCKET_NAME,
        keyTransform: prependKeyPrefix
      }));
    gulp.src('template.yml')
      .pipe(modifyFile(updateArtifactPaths))
      .pipe(s3({
        Bucket: BUCKET_NAME,
        keyTransform: prependKeyPrefix
      }));
  }
);