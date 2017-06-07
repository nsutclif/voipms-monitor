// Lambda doesn't contain either aws cli or zip command
// This was the easiest workaround I could find...

const gulp = require('gulp');
const zip = require('gulp-zip');
const s3 = require('gulp-s3-upload')();

gulp.task('package', () =>
  {
    gulp.src('packaged/**/*')
        .pipe(zip('packaged.zip'))
        .pipe(s3({
          // TODO: Don't hard-code this!
          Bucket: 'lambci-buildresults-ga8wy7gvebrx',
          keyTransform: (relative_filename) => {
            return [ // TODO: Don't hard code this?
              'gh',
              process.env.LAMBCI_REPO,
              'builds',
              process.env.LAMBCI_BUILD_NUM,
              relative_filename
            ].join('/');
          }
        }));
  }
);