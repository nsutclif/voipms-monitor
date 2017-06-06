// The easiest way I could see to zip files and directories in Lambda...

const gulp = require('gulp');
const zip = require('gulp-zip');

gulp.task('package', () =>
  {
    gulp.src('packaged/*')
        .pipe(zip('packaged.zip'))
        .pipe(gulp.dest('./'));
  }
);