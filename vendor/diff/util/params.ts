export function generateOptions(
    options: { [key: string]: any } | ((_: any) => void) | undefined,
    defaults: { [key: string]: any },
): { [key: string]: any } {
    if (typeof options === 'function') {
        defaults.callback = options;
    }
    else if (options) {
        for (const name of Object.keys(options)) {
            defaults[name] = options[name];
        }
    }
    return defaults;
}
