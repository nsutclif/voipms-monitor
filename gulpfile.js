// Lambda doesn't contain either aws cli or zip command
// This was the easiest workaround I could find...

const gulp = require('gulp');
const zip = require('gulp-zip');
const s3 = require('gulp-s3-upload')();

function prependKeyPrefix(relative_filename) {
  return [ // TODO: Don't hard code this?
    'gh',
    process.env.LAMBCI_REPO,
    'builds',
    process.env.LAMBCI_BUILD_NUM,
    relative_filename
  ].join('/');
}

const BUCKET_NAME = 'lambci-buildresults-ga8wy7gvebrx'; // TODO: Don't hard-code this!

gulp.task('package', () =>
  {
    gulp.src('packaged/**/*')
      .pipe(zip('packaged.zip'))
      .pipe(s3({
        Bucket: BUCKET_NAME,
        keyTransform: prependKeyPrefix
      }));
    gulp.src('template.yml')
      .pipe(s3({
        Bucket: BUCKET_NAME,
        keyTransform: prependKeyPrefix
      }));
  }
);