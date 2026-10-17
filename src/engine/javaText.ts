import { t } from '../l10n';
import { JavaOrigin, JavaProblem, JavaSearch, MAXIMUM_JAVA, MINIMUM_JAVA } from './java';

// What the search for a Java runtime found, in the language of the editor. java.ts stays free of the editor: the
// build and its unit tests use it too.

/** Where a runtime was found. */
export const describeOrigin = (origin: JavaOrigin): string => {
    switch (origin.kind) {
        case 'setting':
            return t('java.fromSetting');
        case 'javaHome':
            return 'JAVA_HOME';
        case 'path':
            return t('java.fromPath');
        case 'installed':
            return t('java.installedIn', origin.directory);
    }
};

/** Why a runtime was passed over. */
export const describeProblem = (problem: JavaProblem): string => {
    switch (problem.kind) {
        case 'noExecutable':
            return t('java.noExecutable', problem.file);
        case 'tooOld':
            return t('java.isJava', problem.version);
        case 'tooNew':
            return t('java.isJavaTooNew', problem.version, MAXIMUM_JAVA);
        case 'notStartable':
            return problem.error ?? t('java.couldNotStart');
    }
};

/** What was tried, one runtime after the other. */
export const describeRejections = (search: JavaSearch): string =>
    search.rejected.map(entry => t('java.rejected', entry.path, describeOrigin(entry.origin), describeProblem(entry.problem))).join('; ');

/** Why no runtime can be used, with what was tried. */
export const describeJavaFailure = (search: JavaSearch): string => {
    const summary = search.configuredInvalid
        ? t('errors.theJavaInstallationSetInEnigma')
        : t('errors.enigmaNeedsJavaBetween', MINIMUM_JAVA, MAXIMUM_JAVA);
    const tried = describeRejections(search);
    return tried ? `${summary} (${tried})` : summary;
};
