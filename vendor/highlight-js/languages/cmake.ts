import type { HLJSApi, LanguageDetail } from "../core.ts";

export default function cmake(hljs: HLJSApi): LanguageDetail {
  return {
    name: "CMake",
    case_insensitive: true,
    keywords: {
      $pattern: /[a-zA-Z_][a-zA-Z0-9_-]*/,
      keyword:
        "if elseif else endif foreach endforeach while endwhile function endfunction macro endmacro block endblock break continue return in and or not matches less greater equal less_equal greater_equal strless strgreater strequal strless_equal strgreater_equal version_less version_greater version_equal version_less_equal version_greater_equal defined exists is_directory is_symlink is_absolute command policy target test",
      built_in:
        "cmake_minimum_required cmake_policy project add_executable add_library add_subdirectory add_custom_command add_custom_target add_dependencies add_definitions add_compile_options add_compile_definitions add_link_options target_link_libraries target_include_directories target_compile_definitions target_compile_options target_compile_features target_link_options target_sources set unset list string math file find_package find_library find_path find_program find_file message option configure_file install export include include_directories link_directories set_target_properties get_target_property set_property get_property execute_process enable_testing add_test fetchcontent_declare fetchcontent_makeavailable",
      literal: "on off true false yes no",
    },
    contains: [
      hljs.COMMENT(/#\[\[/, /\]\]/),
      hljs.HASH_COMMENT_MODE,
      {
        className: "variable",
        begin: /\$(?:ENV|CACHE)?\{[^}\n]+\}|\$<[^>\n]+>/,
      },
      {
        className: "string",
        begin: /"/,
        end: /"/,
        contains: [
          hljs.BACKSLASH_ESCAPE,
          {
            className: "variable",
            begin: /\$(?:ENV|CACHE)?\{[^}\n]+\}|\$<[^>\n]+>/,
          },
        ],
      },
      hljs.C_NUMBER_MODE,
    ],
  };
}
