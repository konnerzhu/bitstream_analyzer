cmake_minimum_required(VERSION 3.20)
project(bitscope_h264_inspector VERSION 0.1.0 LANGUAGES CXX)

include(GNUInstallDirs)

option(BITSCOPE_ENABLE_SANITIZERS "Enable AddressSanitizer and UndefinedBehaviorSanitizer" OFF)

find_package(PkgConfig REQUIRED)
pkg_check_modules(FFMPEG REQUIRED IMPORTED_TARGET libavcodec libavutil)

# pkg-config represents Apple frameworks as adjacent `-framework Name` tokens.
# CMake's imported PkgConfig target can flatten those into malformed linker
# arguments when consuming static FFmpeg archives, so spell them as framework
# library items on Apple platforms.
if(APPLE)
  set_property(TARGET PkgConfig::FFMPEG PROPERTY INTERFACE_LINK_OPTIONS "")
  set_property(TARGET PkgConfig::FFMPEG APPEND PROPERTY INTERFACE_LINK_LIBRARIES
    "-framework CoreFoundation"
    "-framework CoreVideo"
    "-framework CoreMedia")
endif()

add_library(bitscope_h264_inspector STATIC src/inspector.cpp)
target_include_directories(bitscope_h264_inspector PUBLIC include)
target_link_libraries(bitscope_h264_inspector PUBLIC PkgConfig::FFMPEG)
target_compile_features(bitscope_h264_inspector PUBLIC cxx_std_20)

add_executable(bitscope-h264-inspect src/main.cpp)
target_link_libraries(bitscope-h264-inspect PRIVATE bitscope_h264_inspector)
target_include_directories(bitscope-h264-inspect PRIVATE ../common)

install(TARGETS bitscope_h264_inspector bitscope-h264-inspect
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(FILES include/bitscope_h264_inspector.h DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

if(MSVC)
  target_compile_options(bitscope_h264_inspector PRIVATE /W4 /WX /sdl)
  target_compile_options(bitscope-h264-inspect PRIVATE /W4 /WX /sdl)
else()
  foreach(target bitscope_h264_inspector bitscope-h264-inspect)
    target_compile_options(${target} PRIVATE
      -Wall -Wextra -Wpedantic -Werror -Wformat -Wformat-security
      -fstack-protector-strong -D_FORTIFY_SOURCE=2)
  endforeach()
  if(BITSCOPE_ENABLE_SANITIZERS)
    foreach(target bitscope_h264_inspector bitscope-h264-inspect)
      target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-omit-frame-pointer)
      target_link_options(${target} PRIVATE -fsanitize=address,undefined)
    endforeach()
  endif()
endif()
