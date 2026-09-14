cmake_minimum_required(VERSION 3.20)
project(bitscope_av1_decoder VERSION 0.1.0 LANGUAGES CXX)

include(GNUInstallDirs)

option(BITSCOPE_AV1_ENABLE_SANITIZERS "Enable AddressSanitizer and UndefinedBehaviorSanitizer" OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(DAV1D REQUIRED IMPORTED_TARGET dav1d>=1.5.1)

add_library(bitscope_av1_decoder STATIC src/decoder.cpp)
target_include_directories(bitscope_av1_decoder PUBLIC include)
target_link_libraries(bitscope_av1_decoder PUBLIC PkgConfig::DAV1D)
target_compile_features(bitscope_av1_decoder PUBLIC cxx_std_20)

add_executable(bitscope-av1-decode src/main.cpp)
target_link_libraries(bitscope-av1-decode PRIVATE bitscope_av1_decoder)
target_include_directories(bitscope-av1-decode PRIVATE ../common)

install(TARGETS bitscope_av1_decoder bitscope-av1-decode
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES include/bitscope_av1_decoder.h DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

if(MSVC)
  target_compile_options(bitscope_av1_decoder PRIVATE /W4 /WX /sdl)
  target_compile_options(bitscope-av1-decode PRIVATE /W4 /WX /sdl)
else()
  foreach(target bitscope_av1_decoder bitscope-av1-decode)
    target_compile_options(${target} PRIVATE
      -Wall -Wextra -Wpedantic -Werror -Wformat -Wformat-security
      -fstack-protector-strong -D_FORTIFY_SOURCE=2)
  endforeach()
  if(BITSCOPE_AV1_ENABLE_SANITIZERS)
    foreach(target bitscope_av1_decoder bitscope-av1-decode)
      target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
      target_link_options(${target} PRIVATE -fsanitize=address,undefined)
    endforeach()
  endif()
endif()
